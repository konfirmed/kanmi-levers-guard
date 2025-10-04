# Changelog

All notable changes to the Kanmi Levers Guard extension will be documented in this file.

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

## Future Roadmap

### v0.2.0 (Planned)
- [ ] Code actions (auto-fix for common issues)
- [ ] Ignore mechanisms (`<!-- kanmi-ignore -->`)
- [ ] Vue/Svelte framework support
- [ ] TypeScript performance anti-patterns
- [ ] Bundle size warnings

### v0.3.0 (Planned)
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
- **GitHub**: https://github.com/kanmiobasa/obasa/tree/main/KanmiLabs/extensions/kanmi-levers-guard
- **Issues**: https://github.com/kanmiobasa/obasa/issues
- **Full Suite**: https://kanmiobasa.com/labs
