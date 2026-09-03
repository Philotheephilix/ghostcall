import './globals.css'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background: '#0F0F0F' }}>
      <body style={{ margin: 0, minHeight: '100vh', background: '#0F0F0F', color: '#fff' }}>
        {children}
      </body>
    </html>
  )
}
