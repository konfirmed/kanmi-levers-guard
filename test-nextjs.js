"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TestPage;
const image_1 = require("next/image");
const head_1 = require("next/head");
function TestPage() {
    return (<>
      <head_1.default>
        {/* ❌ Missing charset */}
        {/* ❌ Missing viewport */}
        <title>Short</title>
        {/* ❌ Missing meta description */}
        {/* ❌ Missing canonical */}

        {/* ❌ Blocking script */}
        <script src="https://cdn.example.com/analytics.js"></script>
      </head_1.default>

      <main>
        <h1>Next.js Test Page</h1>

        {/* ❌ Missing sizes attribute */}
        <image_1.default src="/hero.jpg" alt="Hero" width={1200} height={630}/>

        {/* ✅ Proper Next.js Image */}
        <image_1.default src="/hero2.jpg" alt="Hero with proper attributes" width={1200} height={630} sizes="(max-width: 768px) 100vw, 1200px" priority/>

        {/* ❌ Regular img missing dimensions */}
        <img src="/logo.png" alt="Logo"/>

        {/* ✅ Regular img with all attributes */}
        <img src="/footer.png" alt="Footer image" width="800" height="200" loading="lazy"/>
      </main>
    </>);
}
//# sourceMappingURL=test-nextjs.js.map