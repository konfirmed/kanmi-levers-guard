// Test file for Next.js 13+ App Router - Page with Metadata API

export const metadata = {
  title: 'My App Router Page',
  description: 'This is a page using the new Metadata API in Next.js 13+',
  openGraph: {
    title: 'My App Router Page',
    description: 'This is a page using the new Metadata API',
    images: ['/og-image.jpg'],
  }
}

export default function Page() {
  return (
    <div>
      <h1>App Router Page</h1>
      <p>This page uses the Metadata API - no warnings should appear!</p>
    </div>
  )
}
