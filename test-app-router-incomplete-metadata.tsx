// Test file for Next.js 13+ App Router - Incomplete Metadata
// This should trigger warnings for missing title and description

export const metadata = {
  openGraph: {
    images: ['/og-image.jpg'],
  }
  // Missing: title and description - should get warnings!
}

export default function Page() {
  return (
    <div>
      <h1>Incomplete Metadata</h1>
      <p>Metadata object exists but is missing title and description</p>
    </div>
  )
}
