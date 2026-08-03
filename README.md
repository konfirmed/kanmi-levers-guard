# Kanmi Levers Guard

![Version](https://img.shields.io/visual-studio-marketplace/v/kanmiobasa.kanmi-levers-guard?color=blue)
![Installs](https://img.shields.io/visual-studio-marketplace/i/kanmiobasa.kanmi-levers-guard?color=brightgreen)
![Rating](https://img.shields.io/visual-studio-marketplace/r/kanmiobasa.kanmi-levers-guard)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

**Catch SEO, performance, and Googlebot rendering issues while you code.**

A VSCode extension that provides instant, real-time feedback on SEO, performance, and WRS 2026.1 rules directly in your editor. Source checks are estimates; the production-artifact scan measures uncompressed bytes from built files.

## TL;DR

✅ Detect missing meta tags, bad scripts, and oversized images
⚡ Instantly see SEO & performance warnings in your editor
🧩 Works with HTML, React, Next.js, and TypeScript
📊 Based on Google's Web Rendering Service & Core Web Vitals

## Features

### SEO Checks ✅
- **Meta tags**: Missing/duplicate title, description, viewport, charset
- **Open Graph tags**: Validate social sharing metadata (og:title, og:description, og:image, og:url)
- **Canonical URLs**: Ensure proper canonical link declarations
- **Structured data**: JSON-LD hints for Product and Article pages
- **Image accessibility**: Missing alt attributes
- **Head element ordering**: Optimal placement of charset, title, and critical resources

### Performance Checks ⚡
- **Blocking resources**: Scripts/styles without async/defer attributes
- **Image optimization**: Missing width/height (CLS prevention), lazy loading hints
- **Next.js Image component**: Validate `sizes` and `priority` attributes
- **Font loading**: font-display: swap recommendations, excessive preload warnings
- **HTML size**: Kanmi source-size heuristics; these are not Google WRS limits
- **Resource hints**: Suggest preconnect for external domains
- **Third-party scripts**: Budget enforcement (configurable limit)

### WRS Ruleset 2026.1 🎯
- **2,000,000-byte fetch ceiling**: Production HTML, CSS, JavaScript, and JSON artifacts are checked per URL using uncompressed on-disk bytes. HTTP headers are not available in a workspace scan.
- **Cutoff-content detection**: Errors when title, canonical, robots directives, structured data, main content, or script references begin after byte 2,000,000 in built HTML.
- **Near-limit safety warning**: Configurable production-artifact warning, defaulting to 1.5 MB.
- **PDF separation**: PDF artifacts use a separate 64 MB document rule and are not treated as WRS HTML resources.
- **Documented behavior checks**: Detects interaction-dependent content, persisted-state dependencies, permission gates, WebSocket/WebRTC retrieval, WebGL-only content, non-200 rendering dependencies, robots-blocked resources, unfingerprinted assets, and hard-coded browser-version assumptions.
- **Explicit heuristics**: DOM size/depth, dependency weight, script count, and other performance thresholds are labeled as Kanmi policy heuristics because Google does not publish current numeric WRS limits for them.

### Developer Experience 🎯
- **Real-time diagnostics**: See issues as you type
- **Contextual warnings**: Severity levels (Error, Warning, Info)
- **Actionable messages**: Each diagnostic includes a fix suggestion
- **Workspace scanning**: Bulk analyze entire project with `Kanmi: Scan Workspace` command
- **Custom policies**: Override defaults with `kanmi.policy.json`

## Installation

### From VSCode Marketplace
1. Open VSCode
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux)
3. Search for "Kanmi Levers Guard"
4. Click **Install**

### From Source
```bash
cd KanmiLabs/extensions/kanmi-levers-guard
npm install
npm run build
npx vsce package
code --install-extension kanmi-levers-guard-0.4.0.vsix
```

## Usage

### Automatic Scanning
The extension automatically scans supported files when you:
- Open a file (`.html`, `.jsx`, `.tsx`, `.js`, `.ts`)
- Save a file
- Edit a file (real-time feedback)

### Manual Workspace Scan
Run the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):
```
> Kanmi: Scan Workspace
```

This analyzes up to 5,000 files in your workspace.

### Production Artifact Scan

Run the command palette and choose:
```
> Kanmi: Scan Production Artifacts (WRS 2026.1)
```

This scans built HTML, CSS, JavaScript, JSON, and PDF files under the configured artifact paths. The default paths are `dist`, `build`, `out`, `public`, `.next`, and `artifacts`. Configure these paths when your build output uses a different directory.

The 2,000,000-byte check is authoritative only when applied to the production response. A local artifact proves its uncompressed body size, but it cannot include HTTP headers or server transformations. Verify the live response for final compliance.

### Custom Policy File

Create `kanmi.policy.json` at your workspace root to customize thresholds:

```json
{
  "seo": {
    "titleMin": 30,
    "titleMax": 60,
    "metaDescriptionMin": 50,
    "metaDescriptionMax": 160,
    "requireCanonical": true,
    "requireJsonLdFor": ["Product", "Article"]
  },
  "perf": {
    "maxThirdPartyScriptsPerPage": 6,
    "lcpImageKB": 350,
    "requireFontDisplaySwap": true
  },
  "wrs": {
    "resourceNearLimitBytes": 1500000,
    "productionArtifactPaths": ["dist", "build", ".next"]
  }
}
```

## Configuration

Available settings (Preferences → Settings → Kanmi Levers Guard):

| Setting | Default | Description |
|---------|---------|-------------|
| `kanmi.maxThirdPartyScriptsPerPage` | 6 | Maximum third-party scripts allowed per page |
| `kanmi.lcpImageKB` | 350 | Target size for LCP images (kilobytes) |
| `kanmi.requireCanonical` | true | Require canonical link in documents |
| `kanmi.wrsResourceNearLimitBytes` | 1500000 | Production-artifact safety threshold for uncompressed body bytes |
| `kanmi.productionArtifactPaths` | `dist`, `build`, `out`, `public`, `.next`, `artifacts` | Built-file roots used by the WRS 2026.1 scan |

## Part of the KanmiLabs Ecosystem

Kanmi Levers Guard is the **first line of defense** in the KanmiLabs performance stack. It catches issues during development, but it's not a replacement for production monitoring or pre-deploy auditing.

### Complete Coverage = 3 Tools

```
┌─────────────────────────────────────────┐
│ 1. Kanmi Levers Guard (VSCode)          │ ← You are here
│    Static code analysis while coding    │
│    ✓ Free & open source                 │
│    ✓ No remote service required         │
│    ✗ No real performance metrics        │
├─────────────────────────────────────────┤
│ 2. KanmiSEO Traffic Levers (CLI)        │
│    Deep crawl analysis before launch    │
│    ✓ TTFB measurement (actual timing)   │
│    ✓ Googlebot simulation               │
│    ✓ Multi-page pattern detection       │
│    → Run before deploying to production │
├─────────────────────────────────────────┤
│ 3. KanmiPerf Advanced (Browser)         │
│    Real-time Core Web Vitals tracking   │
│    ✓ LCP, CLS, INP, FCP monitoring      │
│    ✓ Performance scoring & trends       │
│    ✓ AI-powered recommendations         │
│    → Monitor production performance     │
└─────────────────────────────────────────┘
```

**Get the full suite at [kanmiobasa.com/labs](https://kanmiobasa.com/labs)**

- **KanmiSEO Traffic Levers** — Pre-deploy crawl audits
- **KanmiPerf Advanced** — Production monitoring
- **KanmiLabs Suite** — Enterprise SaaS platform

## Examples

### Missing Meta Tags
```html
<!DOCTYPE html>
<html>
<head>
  <!-- ❌ Warning: Missing <meta charset> -->
  <!-- ❌ Warning: Missing <title> -->
  <!-- ❌ Warning: Missing meta description -->
</head>
```

**After fixing:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"> <!-- ✅ First element -->
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Awesome Page</title> <!-- ✅ 30-60 chars -->
  <meta name="description" content="A compelling 50-160 character description for search engines.">
  <link rel="canonical" href="https://example.com/page">
</head>
```

### Blocking Scripts
```html
<head>
  <!-- ❌ Warning: Script without async/defer blocks rendering -->
  <script src="https://cdn.example.com/analytics.js"></script>
</head>
```

**After fixing:**
```html
<head>
  <!-- ✅ Non-blocking script with preconnect -->
  <link rel="preconnect" href="https://cdn.example.com">
  <script src="https://cdn.example.com/analytics.js" defer></script>
</head>
```

### Image Optimization
```jsx
// ❌ Warning: Missing width/height causes CLS
<img src="/hero.jpg" alt="Hero image" />

// ✅ Fixed: Explicit dimensions prevent layout shift
<img
  src="/hero.jpg"
  alt="Hero image"
  width="1200"
  height="630"
  loading="lazy"
/>

// Next.js:
// ❌ Warning: Missing sizes attribute
<Image src="/hero.jpg" alt="Hero" width={1200} height={630} />

// ✅ Fixed: Proper Next.js Image usage
<Image
  src="/hero.jpg"
  alt="Hero"
  width={1200}
  height={630}
  sizes="(max-width: 768px) 100vw, 1200px"
  priority // For LCP images
/>
```

## Kanmi Levers Guard vs Lighthouse vs ESLint

| Tool | Runs Where | Real-time | SEO Checks | Core Web Vitals | Code Fixes |
|------|-------------|-----------|-------------|-----------------|-------------|
| Lighthouse | Browser / CI | ❌ | ✅ | ✅ | ❌ |
| ESLint | Editor / CI | ✅ | ❌ | ❌ | ✅ |
| **Kanmi Levers Guard** | **VS Code and artifact scan** | **✅** | **✅** | **✅** | **No automatic code actions** |

## Why Static Analysis Matters

**Shift-left performance optimization** means catching issues before they reach production:

| Issue Type | Cost if caught in... | Cost if caught in... |
|------------|---------------------|---------------------|
| Missing meta tags | **Editor: 10 seconds** | Production: 2-4 weeks (SEO re-indexing) |
| Blocking scripts | **Editor: 30 seconds** | Production: Angry users, lost revenue |
| Missing image dimensions | **Editor: 15 seconds** | Production: Poor CLS, ranking drop |

**Developer productivity gain**: 5-10 minutes saved per file by catching issues early.

## Limitations (By Design)

Kanmi Levers Guard is primarily a **static analyzer** — it reads source and built files but does not run a live URL. This means:

❌ **No runtime metrics**: Can't measure actual TTFB, LCP, CLS
❌ **No live response analysis**: Can't measure HTTP headers, status codes, compression, redirects, CDN behavior, or server transformations
❌ **No JavaScript execution**: Can't analyze dynamically rendered content
❌ **No multi-page crawling**: Analyzes files individually

The production-artifact scan is stronger than a source estimate, but it still measures local uncompressed body bytes. The authoritative 2,000,000-byte check belongs against each production URL response, including its HTTP headers.

**For these capabilities**, use:
- **KanmiSEO Traffic Levers** → Network timing, crawl budget analysis
- **KanmiPerf Advanced** → Real Core Web Vitals from actual users

## Contributing

Found a bug or have a feature request? Open an issue on [GitHub](https://github.com/konfirmed/kanmi-levers-guard/issues).

## Research & Standards

This extension is built on industry research and official recommendations:

- **Web Almanac 2024**: HTML size benchmarks, Open Graph adoption stats
- **Google Web Rendering Service (WRS)**: Per-URL fetch ceiling and rendering behavior
- **Core Web Vitals**: CLS prevention (image dimensions), LCP optimization (blocking resources)
- **Web.dev Performance Guides**: Async/defer patterns, resource hints, font optimization

**Key sources**:
- [Google Search updates](https://developers.google.com/search/updates)
- [Googlebot documentation](https://developers.google.com/search/docs/crawling-indexing/googlebot)
- [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Lazy-loading guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/lazy-loading)
- [Fix JavaScript-related search issues](https://developers.google.com/search/docs/crawling-indexing/javascript/fix-search-javascript)
- [Google WRS resource access guidance](https://developers.google.com/search/blog/2024/12/crawling-december-resources)
- [Web Almanac 2024 - Performance Chapter](https://almanac.httparchive.org/en/2024/performance)
- [Core Web Vitals](https://web.dev/vitals/)

## License

MIT — Free for commercial and personal use.

## About KanmiLabs

KanmiLabs builds performance tooling for developers who care about speed, SEO, and user experience. Our mission: **Make every website faster.**

**Contact**: i@kanmiobasa.com
