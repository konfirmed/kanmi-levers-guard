import Image from 'next/image'
import Head from 'next/head'

export default function TestPage() {
  return (
    <>
      <Head>
        {/* ❌ Missing charset */}
        {/* ❌ Missing viewport */}
        <title>Short</title>
        {/* ❌ Missing meta description */}
        {/* ❌ Missing canonical */}

        {/* ❌ Blocking script */}
        <script src="https://cdn.example.com/analytics.js"></script>
      </Head>

      <main>
        <h1>Next.js Test Page</h1>

        {/* ❌ Missing sizes attribute */}
        <Image
          src="/hero.jpg"
          alt="Hero"
          width={1200}
          height={630}
        />

        {/* ✅ Proper Next.js Image */}
        <Image
          src="/hero2.jpg"
          alt="Hero with proper attributes"
          width={1200}
          height={630}
          sizes="(max-width: 768px) 100vw, 1200px"
          priority
        />

        {/* ❌ Regular img missing dimensions */}
        <img src="/logo.png" alt="Logo" />

        {/* ✅ Regular img with all attributes */}
        <img
          src="/footer.png"
          alt="Footer image"
          width="800"
          height="200"
          loading="lazy"
        />
      </main>
    </>
  )
}
