import * as net from 'net'

/** v3 onion address with port, e.g. "abc...xyz.onion:7331" */
export const ONION_ADDR_RE = /^[a-z2-7]{56}\.onion:\d{1,5}$/

/** Validates a bare v3 onion hostname (no port) */
export const ONION_HOST_RE = /^[a-z2-7]{56}\.onion$/

/**
 * Connect to a .onion address through a local Tor SOCKS5 proxy.
 *
 * @param onionAddr  "abc123.onion:7331"
 * @param socks      SOCKS5 proxy location, e.g. { host: '127.0.0.1', port: 9050 }
 * @returns          Connected net.Socket (raw — framing is caller's responsibility)
 */
export function connectToOnion(
  onionAddr: string,
  socks: { host: string; port: number },
): Promise<net.Socket> {
  const colonIdx = onionAddr.lastIndexOf(':')
  if (colonIdx === -1) {
    return Promise.reject(new Error(`Invalid onionAddr (no port): ${onionAddr}`))
  }
  const host = onionAddr.slice(0, colonIdx)
  const destPort = parseInt(onionAddr.slice(colonIdx + 1), 10)
  if (isNaN(destPort) || destPort < 1 || destPort > 65535) {
    return Promise.reject(new Error(`Invalid port in onionAddr: ${onionAddr}`))
  }
  if (!ONION_HOST_RE.test(host)) {
    return Promise.reject(new Error(`Invalid .onion address (must be v3): ${host}`))
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SOCKS5 connect timeout (30s)')), 30_000)
    const done = (err?: Error) => {
      clearTimeout(timer)
      if (err) reject(err)
    }

    const socket = net.connect(socks.port, socks.host, () => {
      // Step 1 — SOCKS5 greeting: [VER=5, NMETHODS=1, METHOD=0 (no auth)]
      socket.write(Buffer.from([0x05, 0x01, 0x00]))
    })

    socket.once('data', (res: Buffer) => {
      // Step 2 — server selects no-auth method: [0x05, 0x00]
      if (res[0] !== 0x05 || res[1] !== 0x00) {
        socket.destroy()
        return done(new Error(`SOCKS5 method negotiation failed: ${res.toString('hex')}`))
      }

      // Step 3 — CONNECT request with DOMAINNAME (0x03)
      const hostBuf = Buffer.from(host, 'ascii')
      // [VER, CMD=CONNECT, RSV, ATYP=DOMAINNAME, ADDR_LEN, ...ADDR, PORT_HI, PORT_LO]
      const req = Buffer.allocUnsafe(7 + hostBuf.length)
      req[0] = 0x05        // version
      req[1] = 0x01        // CONNECT
      req[2] = 0x00        // reserved
      req[3] = 0x03        // address type: DOMAINNAME
      req[4] = hostBuf.length
      hostBuf.copy(req, 5)
      req.writeUInt16BE(destPort, 5 + hostBuf.length)
      socket.write(req)

      socket.once('data', (reply: Buffer) => {
        // Step 4 — server response: [VER, REP, RSV, ...]
        if (reply[0] !== 0x05) {
          socket.destroy()
          return done(new Error(`SOCKS5 unexpected response version: ${reply[0]}`))
        }
        if (reply[1] !== 0x00) {
          socket.destroy()
          return done(
            new Error(`SOCKS5 CONNECT failed, reply code: 0x${reply[1].toString(16)}`),
          )
        }
        // Connected — hand off raw socket to caller
        clearTimeout(timer)
        resolve(socket)
      })
    })

    socket.on('error', (err) => {
      done(err)
    })
  })
}
