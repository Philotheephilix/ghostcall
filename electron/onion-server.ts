import * as net from 'net'

/**
 * TCP server that binds on localhost:port — Tor routes external .onion
 * connections to this local port. Caller gets one socket per inbound connection.
 */
export class OnionServer {
  private server: net.Server | null = null

  isListening(): boolean {
    return this.server?.listening ?? false
  }

  listen(
    port: number,
    onConnection: (socket: net.Socket) => void,
  ): Promise<void> {
    if (this.server?.listening) {
      return Promise.reject(new Error(`OnionServer: already listening on port ${port}`))
    }
    return new Promise((resolve, reject) => {
      this.server = net.createServer(onConnection)
      this.server.listen(port, '127.0.0.1', () => resolve())
      this.server.on('error', (err) => {
        this.server = null
        reject(err)
      })
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      const s = this.server
      this.server = null
      s.close(() => resolve())
    })
  }
}

export const onionServer = new OnionServer()
