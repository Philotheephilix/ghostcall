import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TOR_DATA_DIR = path.join(os.homedir(), '.ghostcall-tor')
const SOCKS_HOST = '127.0.0.1'
const SOCKS_PORT = 9050
const CONTROL_PORT = 9051
const ONION_FORWARD_PORT = 7331

export class TorManager {
  private proc: ChildProcess | null = null
  private _running = false
  private activeOnions: Set<string> = new Set()
  // Persistent control sockets per active onion — closing destroys the service
  private onionSockets: Map<string, net.Socket> = new Map()

  async start(): Promise<void> {
    if (this._running) return

    // If Tor is already running externally (SOCKS5 + control port open), attach to it
    const alreadyRunning = await this._checkAlreadyRunning()
    if (alreadyRunning) {
      this._running = true
      return
    }

    const torBin = process.env.TOR_BINARY_PATH || this._findTorBinary()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Tor failed to bootstrap within 60s')),
        60_000,
      )

      this.proc = spawn(
        torBin,
        [
          '--SocksPort', String(SOCKS_PORT),
          '--ControlPort', String(CONTROL_PORT),
          '--CookieAuthentication', '1',
          '--DataDirectory', TOR_DATA_DIR,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )

      const onData = (data: Buffer) => {
        const line = data.toString()
        if (line.includes('Bootstrapped 100%') || line.includes('Bootstrapped 100 percent')) {
          clearTimeout(timer)
          this._running = true
          resolve()
        }
      }

      this.proc.stdout?.on('data', onData)
      this.proc.stderr?.on('data', onData)
      this.proc.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Failed to spawn tor: ${err.message}`))
      })
      this.proc.on('exit', (code) => {
        this._running = false
        if (code !== 0) {
          clearTimeout(timer)
          reject(new Error(`Tor exited with code ${code}`))
        }
      })
    })
  }

  private _findTorBinary(): string {
    const candidates = [
      'tor',
      '/usr/bin/tor',
      '/usr/local/bin/tor',
      '/opt/homebrew/bin/tor',
      '/opt/local/bin/tor',
    ]
    for (const c of candidates) {
      try {
        if (c !== 'tor') {
          fs.accessSync(c, fs.constants.X_OK)
        }
        return c
      } catch {
        // try next
      }
    }
    return 'tor' // last resort — let spawn fail with a clear message
  }

  /**
   * Check if an external Tor process is already running by probing SOCKS5 + control port.
   * If both are open and control port is authenticated, mark as running.
   */
  private _checkAlreadyRunning(): Promise<boolean> {
    const portOpen = (port: number): Promise<boolean> =>
      new Promise(resolve => {
        const s = net.connect(port, '127.0.0.1')
        s.once('connect', () => { s.destroy(); resolve(true) })
        s.once('error', () => resolve(false))
        setTimeout(() => { s.destroy(); resolve(false) }, 2000)
      })
    return Promise.all([portOpen(SOCKS_PORT), portOpen(CONTROL_PORT)])
      .then(([socks, ctrl]) => socks && ctrl)
  }

  /**
   * Create an ephemeral v3 onion service via Tor control port (direct TCP, no library).
   * Returns "serviceId.onion:port"
   */
  async addOnion(localPort: number = ONION_FORWARD_PORT): Promise<string> {
    if (!this._running) {
      throw new Error('TorManager: Tor is not running — call start() first')
    }
    return this._controlCommand(localPort)
  }

  private async _controlCommand(localPort: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(CONTROL_PORT, '127.0.0.1', () => {
        // Read cookie auth file
        const cookiePath = path.join(TOR_DATA_DIR, 'control_auth_cookie')
        let cookie: Buffer
        try {
          cookie = fs.readFileSync(cookiePath)
        } catch (e) {
          socket.destroy()
          return reject(new Error(`Cannot read Tor cookie: ${e}`))
        }

        const cookieHex = cookie.toString('hex').toUpperCase()

        let buf = ''
        const lines: string[] = []

        socket.on('data', (chunk: Buffer) => {
          buf += chunk.toString()
          const parts = buf.split('\r\n')
          buf = parts.pop() ?? ''
          for (const line of parts) {
            if (line) lines.push(line)
          }
          processLines()
        })

        socket.on('error', reject)
        socket.on('close', () => {
          if (!resolved) reject(new Error('Control port connection closed unexpectedly'))
        })

        let step = 0
        let resolved = false

        const processLines = () => {
          while (lines.length > 0) {
            const line = lines.shift()!
            if (step === 0) {
              // Expect "250 OK" after authenticate
              if (line.startsWith('250')) {
                step = 1
                // Send ADD_ONION
                socket.write(
                  `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=${localPort},127.0.0.1:${localPort}\r\n`,
                )
              } else {
                socket.destroy()
                reject(new Error(`Tor AUTH failed: ${line}`))
              }
            } else if (step === 1) {
              // Parse ADD_ONION response: "250-ServiceID=abc..."
              if (line.startsWith('250-ServiceID=')) {
                const serviceId = line.replace('250-ServiceID=', '').trim()
                resolved = true
                this.activeOnions.add(serviceId)
                // Keep the socket OPEN — Tor destroys onion services when the
                // creating control connection closes. Store it for DEL_ONION later.
                this.onionSockets.set(serviceId, socket)
                // Remove QUIT/destroy — just resolve, socket stays alive
                resolve(`${serviceId}.onion:${localPort}`)
              } else if (line.startsWith('5') || line.startsWith('4')) {
                socket.destroy()
                reject(new Error(`ADD_ONION failed: ${line}`))
              }
              // ignore other 250 lines
            }
          }
        }

        // Send AUTHENTICATE
        socket.write(`AUTHENTICATE ${cookieHex}\r\n`)
      })

      socket.on('error', reject)
    })
  }

  async removeOnion(serviceId: string): Promise<void> {
    this.activeOnions.delete(serviceId)
    // Close the persistent socket — this sends implicit DEL_ONION to Tor
    const sock = this.onionSockets.get(serviceId)
    if (sock) {
      this.onionSockets.delete(serviceId)
      try { sock.write('QUIT\r\n') } catch { /* ignore */ }
      sock.destroy()
    }
  }

  getSocksProxy(): { host: string; port: number } {
    return { host: SOCKS_HOST, port: SOCKS_PORT }
  }

  isRunning(): boolean {
    return this._running
  }

  stop(): void {
    this._running = false
    // Close all persistent onion sockets
    for (const [, sock] of this.onionSockets) {
      try { sock.destroy() } catch { /* ignore */ }
    }
    this.onionSockets.clear()
    this.activeOnions.clear()
    this.proc?.kill()
    this.proc = null
  }
}

export const torManager = new TorManager()
