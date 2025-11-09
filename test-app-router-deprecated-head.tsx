// Test file for Next.js 13+ App Router - Using deprecated Head component
// This should trigger a WARNING to use Metadata API instead

import Head from 'next/head'

export default function Page() {
  return (
    <>
      <Head>
        <title>Using Head in App Router - Deprecated!</title>
        <meta name="description" content="This is wrong for App Router" />
      </Head>
      <div>
        <h1>Deprecated Pattern</h1>
        <p>Using Head component in App Router - should get a warning!</p>
      </div>
    </>
  )
}
