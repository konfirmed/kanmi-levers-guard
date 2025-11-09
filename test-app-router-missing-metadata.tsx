// Test file for Next.js 13+ App Router - Page WITHOUT Metadata API
// This should trigger an Information-level suggestion

export default function Page() {
  return (
    <div>
      <h1>App Router Page Without Metadata</h1>
      <p>This page has no metadata export - should get a suggestion</p>
    </div>
  )
}
