import './globals.css'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-black text-white">
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  )
}
