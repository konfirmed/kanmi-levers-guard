# Changelog

All notable changes to the Kanmi Levers Guard extension will be documented in this file.

## [0.4.0] - 2026-08-03

### Added - WRS Ruleset 2026.1

- Added `Kanmi: Scan Production Artifacts (WRS 2026.1)` for built HTML, CSS, JavaScript, JSON, and PDF files.
- Enforced the documented 2,000,000-byte uncompressed fetch ceiling per production URL with `wrs/resource-over-2mb`.
- Added cutoff detection for critical HTML content that begins after byte 2,000,000.
- Added a configurable 1.5 MB default safety warning for production artifacts.
- Added separate PDF size handling at 64 MB; PDF checks are not labeled as WRS rules.
- Added checks for interaction-dependent content, persisted client state, unsupported transports, permission gates, WebGL-only content, non-200 rendering dependencies, unfingerprinted assets, robots-blocked resources, and frozen browser-version assumptions.

### Corrected WRS Classification

- Source-file byte checks now report a static estimate and require production-response verification.
- DOM size/depth, JavaScript bundle size, script count, and other unpublished numeric thresholds are explicitly labeled as Kanmi heuristics or policy budgets.
- Removed the obsolete oversized HTML WRS rules.

### Rule ID Migration

Existing policy suppressions continue to work through aliases for renamed heuristic rules:

| Previous ID | 0.4.0 ID |
|-------------|----------|
| `WRS_DOM_SIZE_WARNING` | `PERF_DOM_SIZE_HEURISTIC` |
| `WRS_DOM_SIZE_EXCEEDED` | `PERF_DOM_SIZE_HEURISTIC_HIGH` |
| `WRS_DOM_DEPTH_WARNING` | `PERF_DOM_DEPTH_HEURISTIC` |
| `WRS_DOM_DEPTH_EXCEEDED` | `PERF_DOM_DEPTH_HEURISTIC_HIGH` |
| `WRS_JS_BUNDLE_SIZE_WARNING` | `PERF_JS_BUNDLE_SIZE_HEURISTIC` |
| `WRS_JS_BUNDLE_SIZE_EXCEEDED` | `PERF_JS_BUNDLE_SIZE_HEURISTIC_HIGH` |
| `PERF_SCRIPT_COUNT_EXCEEDED` | `PERF_SCRIPT_COUNT_POLICY` |

The obsolete HTML size rules were removed because source-file size cannot establish a production response limit.

## [0.3.0] - 2025-11-08

### 🎉 **Major: Next.js 13/14/15 App Router Support**

**Full support for modern Next.js!** Extension now understands App Router, Metadata API, and distinguishes between Pages Router and App Router patterns.

#### Next.js App Router Features

**Metadata API Validation:**
- ✅ Detects `export const metadata = {...}`
- ✅ Detects `export async function generateMetadata()`
- ✅ Validates metadata object structure (title, description)
- ✅ Different rules for `page.tsx` vs `layout.tsx` files
- ✅ Warns when using deprecated `<Head>` component in App Router

**Smart Detection:**
- ✅ Distinguishes App Router (`/app/page.tsx`) from Pages Router (`/pages/index.tsx`)
- ✅ Understands layout/page composition patterns
- ✅ Skips false warnings for metadata inheritance from layouts

**New Error Codes:**
- `SEO_NEXTJS_APPDIR_USE_METADATA_API` - Using deprecated Head in App Router
- `SEO_NEXTJS_METADATA_SUGGESTION` - Suggestion to add metadata export
- `SEO_NEXTJS_METADATA_TITLE_MISSING` - Metadata missing title property
- `SEO_NEXTJS_METADATA_DESC_MISSING` - Metadata missing description property

### 🔧 **Major Noise Reduction**

**Fixed excessive false positives:**
- ✅ Removed duplicate title checks (was checking twice on Next.js files)
- ✅ Made `loading="lazy"` check opt-in (now disabled by default)
- ✅ Skip pure TypeScript utility files (no more warnings on `utils.ts`, `types.ts`)
- ✅ Extension no longer scans its own source code
- ✅ Better Next.js detection (no false positives on `from 'vscode'` imports)

### 🎨 **Enhanced Next.js Support**

**Improved Next.js detection:**
- ✅ Added `next-seo` package detection (skips validation when using next-seo)
- ✅ JSX expression awareness (dynamic titles like `{pageTitle}` no longer flagged)
- ✅ Better meta description parsing (supports both string literals and JSX expressions)

**Improved DOM counting:**
- ✅ Filters out JSX components (only counts actual HTML elements)
- ✅ Excludes TypeScript generics from element count
- ✅ More accurate for React/Next.js files by filtering capitalized JSX components

### ⚙️ **New Configuration Options**

**Rule Disabling (historical example; renamed heuristic IDs are aliased in 0.4.0):**
```json
{
  "disabledRules": ["PERF_IMG_LOADING_MISSING", "PERF_DOM_SIZE_HEURISTIC"]
}
```

**Lazy Loading Control:**
```json
{
  "perf": {
    "requireImageLazyLoading": false  // Default: false (opt-in)
  }
}
```

### 📝 **Examples**

**App Router Page (Next.js 13+):**
```tsx
// ✅ No warnings
export const metadata = {
  title: 'My Page',
  description: 'Page description'
}

export default function Page() {
  return <div>Content</div>
}
```

**Pages Router (Next.js 12):**
```tsx
// ✅ Continues to work as before
import Head from 'next/head'

export default function Page() {
  return (
    <>
      <Head>
        <title>My Page</title>
      </Head>
      <div>Content</div>
    </>
  )
}
```

**Using next-seo:**
```tsx
// ✅ No warnings (next-seo is trusted)
import { NextSeo } from 'next-seo'

export default function Page() {
  return (
    <>
      <NextSeo title="My Page" description="..." />
      <div>Content</div>
    </>
  )
}
```

### 🐛 **Fixed**

- Fixed: Extension scanning its own source files
- Fixed: Duplicate title warnings on Next.js files
- Fixed: Incorrect Next.js detection (matching `from 'vscode'` as Next.js)
- Fixed: Pure TypeScript files getting SEO warnings
- Fixed: DOM size calculation including JSX components
- Fixed: Missing validation for dynamic JSX content in titles

### 📊 **Historical impact notes**

The following notes describe the original 0.3.0 release work. They are qualitative release notes, not independently benchmarked coverage claims.

**Noise Reduction:**
- Fewer warnings on Next.js files after duplicate checks were removed
- Pure TypeScript utility files are skipped
- Image lazy-loading warnings are opt-in

**Accuracy Improvement:**
- Next.js App Router metadata detection was added
- JSX expression handling was improved
- DOM counting filters capitalized JSX components

### 🔄 **Migration from 0.2.x**

**No breaking changes!** The extension is fully backward compatible.

**What changed:**
- `loading="lazy"` warnings are now disabled by default (opt-in via `requireImageLazyLoading`)
- Pure `.ts` files are no longer scanned for SEO issues (unless they're Next.js pages)

**Recommended actions:**
1. Reload your Extension Development Host to see the improvements
2. Add `kanmi.policy.json` to customize rules if needed
3. Test on App Router projects and review diagnostics for the project context.

---

## [0.2.2] - 2025-10-04

### Changed - Marketplace SEO Optimization

**Improved Discoverability:**
- ✅ Updated displayName to "Kanmi Levers Guard - SEO & Performance Linter"
- ✅ Enhanced keywords: lighthouse, web performance, page speed, static analysis
- ✅ Optimized README with TL;DR, badges, and comparison table

**No functional changes** - Metadata update for better marketplace ranking.

---

## [0.2.1] - 2025-10-04

### 🎯 **Major: Context-Aware Rule System**

**Fixed the core issue:** Extension no longer treats every file like an HTML file!

**Before:** Applied HTML `<head>` rules to all files (JSX, TSX, JS) causing irrelevant warnings.
**After:** Smart detection applies appropriate rules based on file type and framework.

#### Context Detection & Rule Application

**HTML Files (`.html`):**
- ✅ Traditional `<head>`, `<title>`, `<meta>` validation
- ✅ Head element ordering checks
- ✅ Canonical link validation

**Next.js Files (with `next/head` imports):**
- ✅ `<Head>` component validation
- ✅ Next.js-specific error codes (`SEO_NEXTJS_*`)
- ✅ Framework-appropriate suggestions

**React Files (with Helmet):**
- ✅ `<Helmet>` component validation
- ✅ React-specific error codes (`SEO_HELMET_*`)

**Pure JS/React Components:**
- ✅ Bundle size & performance warnings only
- ❌ No irrelevant head/SEO warnings

### Added

- **Extension Icon** - Professional shield-style icon with SEO/performance indicators
- **New Error Codes:**
  - `SEO_NEXTJS_TITLE_MISSING` - Missing title in Next.js `<Head>`
  - `SEO_NEXTJS_META_DESC_MISSING` - Missing meta description in Next.js `<Head>`
  - `SEO_NEXTJS_CANONICAL_MISSING` - Missing canonical in Next.js `<Head>`
  - `SEO_HELMET_TITLE_MISSING` - Missing title in React Helmet

### Fixed

- **No more false positives** on pure React components
- **Framework-appropriate suggestions** for Next.js and React files
- **Better developer experience** with relevant rules per file type

### Improved

- **Developer adoption ready** - Extension now works correctly across HTML, React, and Next.js projects
- **Cleaner codebase** - Separate rule functions for each context
- **Backwards compatible** - Existing HTML projects work exactly as before

---

## [0.2.0] - 2025-10-04

### Added - Google WRS Optimization Features 🚀

**Major WRS Enhancements:**
- ✅ **DOM size monitoring** - Warns if element count > 800, warns at > 1,500 (legacy Kanmi heuristics)
- ✅ **DOM depth tracking** - Detects excessive nesting > 25 levels, warns at 32+ (legacy Kanmi heuristics)
- ✅ **JavaScript bundle size estimation** - Analyzes imports and warns about heavy dependencies
- ✅ **Legacy HTML size heuristics** - Superseded by the WRS 2026.1 production-artifact scanner

**Heavy Dependency Detection:**

Detects 10 common heavy libraries with size estimates and alternatives:
- `moment` (67KB) → suggest `date-fns` (2KB)
- `lodash` (72KB) → suggest `lodash-es + tree-shaking`
- `jquery` (87KB) → suggest `vanilla JS`
- `@material-ui/core` (350KB) → suggest `@mui/material with tree-shaking`
- `three` (580KB), `d3` (250KB), and more

**Example Warnings:**
```typescript
import moment from 'moment';
// ⚠️ Heavy dependency: moment (~67KB). Consider date-fns (2KB)

// If total exceeds the legacy Kanmi heuristic:
// Estimated JS bundle size: ~1206KB - consider code splitting
```

### Improved

**WRS Optimization Notes:**
- Added DOM size and depth heuristics
- Added JavaScript dependency-weight estimation
- Added legacy HTML source-size heuristics, now superseded by the 0.4.0 artifact scanner

**Breakdown:**
- Head element ordering: unchanged
- HTML size: legacy source heuristics
- DOM size: added element-count monitoring
- JS weight: added import analysis

### Technical Details

**DOM Size Checking:**
```typescript
const totalElements = text.match(/<[a-zA-Z][^/>]*>/g).length;
if (totalElements > 800) warn("Exceeds Kanmi performance heuristic");
if (totalElements > 1500) warn("Exceeds high Kanmi performance heuristic");
```

**DOM Depth Calculation:**
```typescript
const maxDepth = calculateMaxDOMDepth(html); // Stack-based tracking
if (maxDepth > 25) warn();
if (maxDepth > 32) warn(); // Google publishes no numeric WRS DOM-depth limit
```

**Import Analysis:**
```typescript
// Matches ES6: import X from 'Y'
// Matches CJS: require('Y')
// Estimates bundle size from database of 10 heavy libraries
```

## [0.1.1] - 2025-10-04

### Fixed - Performance & User Experience

**Immediate Risk Fixes:**
- ✅ **Added file size limit (500KB)** - Prevents lag on large files
- ✅ **Added debouncing (300ms)** - Reduces CPU usage during typing
- ✅ **Framework detection** - Smarter warnings for Next.js/React files

**Medium-Term Risk Fixes:**
- ✅ **Progress notifications** - Shows scanning progress in workspace scan
- ✅ **Cancellable workspace scan** - Can interrupt long-running scans

### Changed

- **Updated links** - Now points to `kanmiobasa.com/labs` instead of private repo paths
- **Better error handling** - Extension skips files gracefully instead of crashing

### Technical Details

**Performance Improvements:**
```typescript
// Before: Scanned on every keystroke immediately
onDidChangeTextDocument((e) => scanDocument(e.document))

// After: Debounced 300ms, skip large files
onDidChangeTextDocument((e) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => scanDocument(e.document), 300);
})
```

**Framework Detection:**
```typescript
// Now detects Next.js/React to avoid false positives
const isNextJs = text.includes('next/head');
const isReact = text.includes('import React');
const isJsxFile = /\.(jsx|tsx)$/.test(doc.fileName);

// Skips warnings for meta tags in JSX files (handled by framework)
if (/<head>/i.test(text) && !isNextJs && !isJsxFile) {
  // Only warn for plain HTML files
}
```

**Workspace Scan with Progress:**
```typescript
// Before: No feedback during scan
for (const file of files) {
  await scanDocument(file);
}

// After: Progress bar with cancellation
await vscode.window.withProgress({
  location: vscode.ProgressLocation.Notification,
  cancellable: true
}, async (progress, token) => {
  // Shows: "Scanning 245/500 files (49%)"
});
```

## [0.1.0] - 2025-10-04

### Added - Initial Release

**SEO Checks:**
- Meta tags validation (title, description, viewport, charset)
- Open Graph tags validation
- Canonical URL checks
- JSON-LD structured data hints
- Image alt attribute warnings
- Head element ordering recommendations

**Performance Checks:**
- Blocking resources detection (scripts/styles without async/defer)
- Image optimization (width/height, lazy loading)
- Next.js Image component validation
- Font loading recommendations (font-display: swap)
- HTML size warnings (Web Almanac 2024 benchmarks)
- Resource hints (preconnect suggestions)
- Third-party script budgeting

**Developer Experience:**
- Real-time diagnostics as you type
- Workspace scan command
- Custom policy file (`kanmi.policy.json`)
- Configurable thresholds via VSCode settings

---

## Retired Pre-0.4.0 Roadmap

The entries below are retained as historical planning notes. Completed work is documented in the release sections above.

### v0.2.0 (Historical)
- [ ] Code actions (auto-fix for common issues)
- [ ] Ignore mechanisms (`<!-- kanmi-ignore -->`)
- [ ] Vue/Svelte framework support
- [ ] TypeScript performance anti-patterns
- [ ] Bundle size warnings

### v0.3.0 (Historical)
- [ ] Proper HTML/JSX parser (replace regex)
- [ ] Accessibility checks (WCAG compliance)
- [ ] More granular severity levels
- [ ] Custom rule creation

---

## Migration Guide

### Upgrading from 0.1.0 → 0.1.1

No breaking changes. Extension will automatically:
- Skip files >500KB (log message in console)
- Debounce real-time scanning
- Show progress during workspace scans

**New behavior:**
- Fewer false positives in Next.js/React files
- Better performance in large projects
- Cancellable workspace scans (press "Cancel" button)

**Recommended:**
- Update links to `kanmiobasa.com/labs` if you referenced old paths
- Test on your largest project - should feel faster!

---

## Links

- **Marketplace**: https://marketplace.visualstudio.com/items?itemName=kanmiobasa.kanmi-levers-guard
- **GitHub**: https://github.com/konfirmed/kanmi-levers-guard
- **Issues**: https://github.com/konfirmed/kanmi-levers-guard/issues
- **Full Suite**: https://kanmiobasa.com/labs
