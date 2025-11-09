// Test file for Next.js 13+ App Router - Layout with Metadata

export const metadata = {
  title: {
    default: 'My Site',
    template: '%s | My Site'
  },
  description: 'Default site description for all pages'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
