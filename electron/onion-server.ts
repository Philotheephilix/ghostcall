import * as net from 'net'

/**
 * TCP server that binds on localhost:port — Tor routes external .onion
 * connections to this local port. Caller gets one socket per inbound connection.
 */
export class OnionServer {
  private server: net.Server | null = null

  listen(
    port: number,
    onConnection: (socket: net.Socket) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer(onConnection)
      this.server.listen(port, '127.0.0.1', () => resolve())
      this.server.on('error', reject)
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
  }
}

export const onionServer = new OnionServer()
