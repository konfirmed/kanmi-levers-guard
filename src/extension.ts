import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface describing an optional policy file.
 * Users can place a kanmi.policy.json at the root of their workspace to
 * override default budgets and thresholds.
 */
interface Policy {
  seo?: {
    titleMin?: number;
    titleMax?: number;
    metaDescriptionMin?: number;
    metaDescriptionMax?: number;
    requireCanonical?: boolean;
    requireJsonLdFor?: string[];
  };
  perf?: {
    maxThirdPartyScriptsPerPage?: number;
    lcpImageKB?: number;
    requireFontDisplaySwap?: boolean;
  };
}

/**
 * Attempt to read a policy JSON file from the root of the first workspace folder.
 */
function readPolicy(): Policy {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return {};
  }
  const policyPath = path.join(folder.uri.fsPath, 'kanmi.policy.json');
  try {
    const content = fs.readFileSync(policyPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Helper to build a diagnostic object with common fields.
 */
function buildDiagnostic(
  range: vscode.Range,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity
): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(range, message, severity);
  diag.code = code;
  diag.source = 'Kanmi';
  return diag;
}

/**
 * Test whether a value lies within a range of inclusive min and max.
 */
function within(n: number, min: number, max: number): boolean {
  return n >= min && n <= max;
}

/**
 * Calculate maximum DOM nesting depth for WRS optimization.
 * Uses a simple stack-based approach to track nested elements.
 */
function calculateMaxDOMDepth(html: string): number {
  let maxDepth = 0;
  let currentDepth = 0;

  // Match opening and closing tags
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  const selfClosingTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();

    // Skip self-closing tags and void elements
    if (selfClosingTags.has(tagName) || fullTag.endsWith('/>')) {
      continue;
    }

    if (fullTag.startsWith('</')) {
      // Closing tag - decrease depth
      currentDepth = Math.max(0, currentDepth - 1);
    } else {
      // Opening tag - increase depth
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    }
  }

  return maxDepth;
}

/**
 * Activate the extension.
 */
export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection('kanmi');
  context.subscriptions.push(collection);

  // Debounce timer for real-time scanning
  let debounceTimer: NodeJS.Timeout | undefined;

  /**
   * Scan a single document for SEO and performance issues.
   */
  async function scanDocument(doc: vscode.TextDocument) {
    // Only process JavaScript/TypeScript/JSX/TSX/HTML files.
    if (!/\.(jsx?|tsx?|html)$/.test(doc.fileName)) {
      return;
    }

    // PERFORMANCE FIX: Skip files larger than 500KB
    const text = doc.getText();
    const fileSizeKB = Buffer.byteLength(text, 'utf8') / 1024;
    if (fileSizeKB > 500) {
      console.log(`[Kanmi] Skipping large file: ${doc.fileName} (${Math.round(fileSizeKB)}KB)`);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const policy = readPolicy();

    // FRAMEWORK DETECTION: Detect Next.js/React to avoid false positives
    const isNextJs = text.includes('next/head') || text.includes('from "next"') || text.includes("from 'next'");
    const isReact = text.includes('import React') || text.includes('from "react"') || text.includes("from 'react'");
    const isJsxFile = /\.(jsx|tsx)$/.test(doc.fileName);

    /** SEO rules */
    // Title tag: ensure it exists and length is in a reasonable range.
    const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(text);
    const titleMin = policy.seo?.titleMin ?? 30;
    const titleMax = policy.seo?.titleMax ?? 60;
    if (titleMatch) {
      const title = titleMatch[1].trim();
      const start = doc.positionAt(titleMatch.index);
      const end = doc.positionAt(titleMatch.index + titleMatch[0].length);
      const range = new vscode.Range(start, end);
      if (!within(title.length, titleMin, titleMax)) {
        diagnostics.push(
          buildDiagnostic(
            range,
            `Title length is ${title.length} characters; aim for ${titleMin}–${titleMax} characters.`,
            'SEO_TITLE_LENGTH',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    } else {
      // If no title tag is present but the file includes <head>, warn.
      // SKIP for Next.js/React files (they use <Head> component)
      if (/<head>/i.test(text) && !isNextJs && !isJsxFile) {
        const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
        diagnostics.push(
          buildDiagnostic(
            range,
            'Missing <title>. Add a focused, query‑matching title (30–60 characters).',
            'SEO_TITLE_MISSING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }

    // Meta description: ensure it exists and has reasonable length.
    const metaDescMatch = /<meta\s+name=["']description["']\s+content=["']([^"']+)["'][^>]*>/i.exec(text);
    const descMin = policy.seo?.metaDescriptionMin ?? 50;
    const descMax = policy.seo?.metaDescriptionMax ?? 160;
    if (metaDescMatch) {
      const desc = metaDescMatch[1].trim();
      const start = doc.positionAt(metaDescMatch.index);
      const end = doc.positionAt(metaDescMatch.index + metaDescMatch[0].length);
      const range = new vscode.Range(start, end);
      if (!within(desc.length, descMin, descMax)) {
        diagnostics.push(
          buildDiagnostic(
            range,
            `Meta description is ${desc.length} characters; aim for ${descMin}–${descMax} characters.`,
            'SEO_META_DESC_LENGTH',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
    } else {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      diagnostics.push(
        buildDiagnostic(
          range,
          'Missing meta description. Add a 50–160 character description to improve click‑through rate.',
          'SEO_META_DESC_MISSING',
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    // Canonical link: warn if missing when configured.
    const requireCanonical =
      policy.seo?.requireCanonical ??
      (vscode.workspace.getConfiguration().get('kanmi.requireCanonical', true) as boolean);
    if (requireCanonical) {
      const canonicalMatch = /<link\s+rel=["']canonical["']\s+href=["'][^"']+["'][^>]*>/i.exec(text);
      if (!canonicalMatch) {
        const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
        diagnostics.push(
          buildDiagnostic(
            range,
            'Missing canonical link. Add <link rel="canonical" href="…"> to declare a preferred URL.',
            'SEO_CANONICAL_MISSING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }

    // JSON‑LD hints: suggest adding product/article structured data when relevant keywords are present.
    const requireTypes = policy.seo?.requireJsonLdFor ?? [];
    if (requireTypes.length) {
      const hasJsonLd = /<script\s+type=["']application\/ld\+json["']>/.test(text);
      const fileLower = doc.fileName.toLowerCase();
      const isProductLike =
        /(product|pdp|sku|price|add[\s_-]?to[\s_-]?cart)/i.test(text) ||
        /(product|pdp|sku)/.test(fileLower);
      const isArticleLike =
        /(blog|article|news|post)/i.test(text) || /(blog|article)/.test(fileLower);
      if (requireTypes.includes('Product') && isProductLike && !hasJsonLd) {
        diagnostics.push(
          buildDiagnostic(
            new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
            'Product page likely missing JSON‑LD (Product). Consider adding product structured data.',
            'SEO_JSONLD_PRODUCT_MISSING',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
      if (requireTypes.includes('Article') && isArticleLike && !hasJsonLd) {
        diagnostics.push(
          buildDiagnostic(
            new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
            'Article page likely missing JSON‑LD (Article). Consider adding article structured data.',
            'SEO_JSONLD_ARTICLE_MISSING',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
    }

    // Open Graph validation (Web Almanac 2024: 53-61% of pages use OG tags)
    const ogTags = {
      'og:title': /<meta\s+property=["']og:title["']\s+content=["'][^"']+["'][^>]*>/i.test(text),
      'og:description': /<meta\s+property=["']og:description["']\s+content=["'][^"']+["'][^>]*>/i.test(text),
      'og:image': /<meta\s+property=["']og:image["']\s+content=["'][^"']+["'][^>]*>/i.test(text),
      'og:url': /<meta\s+property=["']og:url["']\s+content=["'][^"']+["'][^>]*>/i.test(text)
    };
    const missingOg = Object.entries(ogTags).filter(([_, present]) => !present).map(([tag]) => tag);
    if (missingOg.length >= 3 && /<head>/i.test(text)) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Missing ${missingOg.length}/4 Open Graph tags: ${missingOg.join(', ')}. These improve social media sharing.`,
          'SEO_OG_TAGS_MISSING',
          vscode.DiagnosticSeverity.Information
        )
      );
    }

    // HTML size estimation (warn if >100KB)
    const htmlSizeKB = Buffer.byteLength(text, 'utf8') / 1024;
    if (htmlSizeKB > 100 && htmlSizeKB <= 150) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `HTML file is ${Math.round(htmlSizeKB)}KB. Consider code splitting or removing inline data. (Web Almanac p90: 147KB)`,
          'PERF_HTML_SIZE_LARGE',
          vscode.DiagnosticSeverity.Warning
        )
      );
    } else if (htmlSizeKB > 150 && htmlSizeKB <= 10000) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `HTML file is ${Math.round(htmlSizeKB)}KB - larger than 90% of websites. This impacts parsing performance.`,
          'PERF_HTML_SIZE_EXCESSIVE',
          vscode.DiagnosticSeverity.Error
        )
      );
    } else if (htmlSizeKB > 10000) {
      // WRS: Google's 15MB limit warning
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `HTML file is ${Math.round(htmlSizeKB/1024)}MB. Approaching Google's 15MB WRS limit. Consider pagination or dynamic loading.`,
          'WRS_HTML_SIZE_APPROACHING_LIMIT',
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
    if (htmlSizeKB > 14000) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `HTML file is ${Math.round(htmlSizeKB/1024)}MB. Google WRS will truncate at 15MB. URGENT: Reduce file size!`,
          'WRS_HTML_SIZE_CRITICAL',
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    // WRS: DOM size optimization (Google recommends < 1,500 elements)
    // Count opening tags (excluding self-closing and closing tags)
    const openingTags = text.match(/<[a-zA-Z][^/>]*>/g) || [];
    const totalElements = openingTags.length;

    if (totalElements > 800) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `DOM has ${totalElements} elements. Google WRS recommends < 800 for optimal rendering. Consider pagination or lazy loading.`,
          'WRS_DOM_SIZE_WARNING',
          vscode.DiagnosticSeverity.Information
        )
      );
    }
    if (totalElements > 1500) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `DOM has ${totalElements} elements. Google WRS hard limit is 1,500. Page may not render correctly in search results.`,
          'WRS_DOM_SIZE_EXCEEDED',
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    // WRS: DOM depth check (Google recommends < 32 levels)
    const maxDepth = calculateMaxDOMDepth(text);
    if (maxDepth > 25) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `DOM depth is ${maxDepth} levels. Google WRS recommends < 32 to avoid rendering issues. Flatten your HTML structure.`,
          'WRS_DOM_DEPTH_WARNING',
          vscode.DiagnosticSeverity.Information
        )
      );
    }
    if (maxDepth > 32) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `DOM depth is ${maxDepth} levels - exceeds Google WRS limit of 32. Googlebot may fail to render this page.`,
          'WRS_DOM_DEPTH_EXCEEDED',
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    // Head element ordering checks (based on KanmiSEO analyzer.py patterns)
    const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(text);
    if (headMatch) {
      const headContent = headMatch[1];
      const headStart = headMatch.index + headMatch[0].indexOf('>') + 1;

      // Extract positions of key elements in head
      const charsetMatch = /<meta\s+charset=/i.exec(headContent);
      const titleMatchPos = /<title>/i.exec(headContent);
      const firstStyleMatch = /<link\s+[^>]*rel=["']stylesheet["']/i.exec(headContent);
      const firstScriptMatch = /<script[^>]*>/i.exec(headContent);

      // Charset should be first
      if (charsetMatch && charsetMatch.index > 100) {
        const charsetPos = doc.positionAt(headStart + charsetMatch.index);
        diagnostics.push(
          buildDiagnostic(
            new vscode.Range(charsetPos, charsetPos),
            '<meta charset> should be the first element in <head> to prevent re-parsing.',
            'SEO_CHARSET_ORDERING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }

      // Title should come before stylesheets
      if (titleMatchPos && firstStyleMatch && titleMatchPos.index > firstStyleMatch.index) {
        const titlePos = doc.positionAt(headStart + titleMatchPos.index);
        diagnostics.push(
          buildDiagnostic(
            new vscode.Range(titlePos, titlePos),
            '<title> should appear before stylesheets for faster discovery by search engines.',
            'SEO_TITLE_ORDERING',
            vscode.DiagnosticSeverity.Information
          )
        );
      }

      // Title should come before blocking scripts
      if (titleMatchPos && firstScriptMatch && titleMatchPos.index > firstScriptMatch.index) {
        const titlePos = doc.positionAt(headStart + titleMatchPos.index);
        diagnostics.push(
          buildDiagnostic(
            new vscode.Range(titlePos, titlePos),
            '<title> should appear before blocking scripts to avoid crawl delays.',
            'SEO_TITLE_SCRIPT_ORDERING',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
    }

    // Check image tags (<img>).
    const imgTagRegex = /<img\s+([^>]*?)>/gi;
    let match: RegExpExecArray | null;
    while ((match = imgTagRegex.exec(text)) !== null) {
      const attrs = match[1];
      const hasAlt = /\balt\s*=\s*["'][^"']*["']/.test(attrs);
      const hasWidth = /\bwidth\s*=/.test(attrs);
      const hasHeight = /\bheight\s*=/.test(attrs);
      const hasLoading = /\bloading\s*=\s*["'](lazy|eager)["']/i.test(attrs);

      const start = doc.positionAt(match.index);
      const end = doc.positionAt(match.index + match[0].length);
      const range = new vscode.Range(start, end);

      if (!hasAlt) {
        diagnostics.push(
          buildDiagnostic(
            range,
            'Image missing alt attribute. Add a meaningful `alt` for accessibility and SEO.',
            'SEO_IMG_ALT_MISSING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
      if (!hasWidth || !hasHeight) {
        diagnostics.push(
          buildDiagnostic(
            range,
            'Image missing width/height attributes. Explicit dimensions prevent layout shift.',
            'PERF_IMG_DIMENSIONS_MISSING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
      if (!hasLoading) {
        diagnostics.push(
          buildDiagnostic(
            range,
            'Consider adding loading="lazy" to defer off‑screen images.',
            'PERF_IMG_LOADING_MISSING',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
    }

    // Check Next.js <Image /> component.
    const nextImgRegex = /<Image\s+([^>]*?)\/?>/gi;
    while ((match = nextImgRegex.exec(text)) !== null) {
      const attrs = match[1];
      const hasSizes = /\bsizes\s*=/.test(attrs);
      const hasPriority = /\bpriority\b/.test(attrs) || /\bpriority\s*=\s*{?true}?/.test(attrs);
      const srcMatch = /\bsrc\s*=\s*{?["']([^"']+)["']}?/.exec(attrs);
      const src = srcMatch ? srcMatch[1] : '';
      const likelyLcp = /(hero|banner|masthead)/i.test(src) || /\bpriority\b/.test(attrs);

      const start = doc.positionAt(match.index);
      const end = doc.positionAt(match.index + match[0].length);
      const range = new vscode.Range(start, end);

      if (!hasSizes) {
        diagnostics.push(
          buildDiagnostic(
            range,
            'next/image missing `sizes` attribute. Without it, the browser may fetch incorrect resolutions.',
            'PERF_NEXTIMG_SIZES_MISSING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
      if (likelyLcp && !hasPriority) {
        diagnostics.push(
          buildDiagnostic(
            range,
            'Likely LCP image missing `priority`. Add `priority` to improve initial load.',
            'PERF_NEXTIMG_PRIORITY_MISSING',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
    }

    // Check custom fonts for font-display: swap and excessive preloads.
    const fontFaceRegex = /@font-face\s*{[\s\S]*?}/gi;
    let fmatch: RegExpExecArray | null;
    while ((fmatch = fontFaceRegex.exec(text)) !== null) {
      const block = fmatch[0];
      const start = doc.positionAt(fmatch.index);
      const end = doc.positionAt(fmatch.index + fmatch[0].length);
      const range = new vscode.Range(start, end);
      if (!/font-display\s*:\s*swap/.test(block)) {
        diagnostics.push(
          buildDiagnostic(
            range,
            'Custom font is missing `font-display: swap`. This can block rendering.',
            'PERF_FONT_DISPLAY_MISSING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }
    // Preload font count
    const preloadFontMatches = text.match(/<link\s+[^>]*rel=["']preload["'][^>]*as=["']font["'][^>]*>/gi) || [];
    if (preloadFontMatches.length > 4) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Too many font preloads (${preloadFontMatches.length}). Limit preloaded fonts to critical subsets.`,
          'PERF_FONT_PRELOAD_EXCESS',
          vscode.DiagnosticSeverity.Information
        )
      );
    }

    // WRS: JavaScript bundle size estimation via import analysis
    // Database of common heavy libraries (sizes in KB, uncompressed)
    const heavyLibraries: Record<string, { size: number; alternative?: string }> = {
      'moment': { size: 67, alternative: 'date-fns (2KB)' },
      'moment-timezone': { size: 190, alternative: 'date-fns-tz (11KB)' },
      'lodash': { size: 72, alternative: 'lodash-es + tree-shaking' },
      'jquery': { size: 87, alternative: 'vanilla JS or cash-dom (6KB)' },
      '@material-ui/core': { size: 350, alternative: '@mui/material with tree-shaking' },
      'rxjs': { size: 166, alternative: 'rxjs + specific operators only' },
      'xlsx': { size: 800, alternative: 'xlsx-populate (smaller)' },
      'chart.js': { size: 150, alternative: 'chartist (10KB)' },
      'three': { size: 580, alternative: 'three + tree-shaking' },
      'd3': { size: 250, alternative: 'd3 + specific modules only' }
    };

    // Match import statements (ES6 and CommonJS)
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let totalEstimatedBundleSize = 0;
    let importMatch;

    while ((importMatch = importRegex.exec(text)) !== null) {
      const importPath = importMatch[1] || importMatch[2];
      // Extract package name (handle scoped packages)
      const packageName = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0];

      if (heavyLibraries[packageName]) {
        const lib = heavyLibraries[packageName];
        totalEstimatedBundleSize += lib.size;

        const start = doc.positionAt(importMatch.index);
        const end = doc.positionAt(importMatch.index + importMatch[0].length);
        const range = new vscode.Range(start, end);

        diagnostics.push(
          buildDiagnostic(
            range,
            `Heavy dependency: ${packageName} (~${lib.size}KB). ${lib.alternative ? `Consider ${lib.alternative}` : 'Use tree-shaking or code splitting.'}`,
            'WRS_HEAVY_DEPENDENCY',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
    }

    // Warn if estimated bundle size is large
    if (totalEstimatedBundleSize > 500) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Estimated JS bundle size: ~${totalEstimatedBundleSize}KB from heavy dependencies. Google WRS recommends < 1MB total. Consider code splitting.`,
          'WRS_JS_BUNDLE_SIZE_WARNING',
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
    if (totalEstimatedBundleSize > 1000) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Estimated JS bundle size: ~${totalEstimatedBundleSize}KB - exceeds Google WRS 1MB recommendation. This will impact crawl budget and rendering.`,
          'WRS_JS_BUNDLE_SIZE_EXCEEDED',
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    // Count third‑party scripts and ensure async/defer.
    const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let scriptCount = 0;
    let sMatch: RegExpExecArray | null;
    const externalDomains = new Set<string>();

    while ((sMatch = scriptRegex.exec(text)) !== null) {
      scriptCount++;
      const tag = sMatch[0];
      const src = sMatch[1];
      const attrs = tag;
      const hasAsyncOrDefer = /\basync\b/.test(attrs) || /\bdefer\b/.test(attrs);
      const start = doc.positionAt(sMatch.index);
      const end = doc.positionAt(sMatch.index + sMatch[0].length);
      const range = new vscode.Range(start, end);

      // Track external domains for preconnect suggestions
      try {
        if (src.startsWith('http')) {
          const url = new URL(src);
          externalDomains.add(url.origin);
        }
      } catch {}

      if (!hasAsyncOrDefer) {
        diagnostics.push(
          buildDiagnostic(
            range,
            'Script tag without `async` or `defer`. This can block rendering.',
            'PERF_SCRIPT_BLOCKING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }
    const maxTP = policy.perf?.maxThirdPartyScriptsPerPage ??
      (vscode.workspace.getConfiguration().get('kanmi.maxThirdPartyScriptsPerPage', 6) as number);
    if (scriptCount > maxTP) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Document contains ${scriptCount} script tags. Budget is ${maxTP}.`,
          'PERF_SCRIPT_COUNT_EXCEEDED',
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    // Resource hint recommendations (preconnect for external domains)
    const hasPreconnect = /<link\s+[^>]*rel=["']preconnect["']/i.test(text);
    const hasStylesheets = /<link\s+[^>]*rel=["']stylesheet["']/i.test(text);
    const stylesheetRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
    let styleMatch: RegExpExecArray | null;

    while ((styleMatch = stylesheetRegex.exec(text)) !== null) {
      const href = styleMatch[1];
      try {
        if (href.startsWith('http')) {
          const url = new URL(href);
          externalDomains.add(url.origin);
        }
      } catch {}
    }

    // Suggest preconnect for external domains
    if (externalDomains.size > 0 && !hasPreconnect) {
      const domains = Array.from(externalDomains).slice(0, 3); // Top 3
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Consider adding <link rel="preconnect"> for external domains: ${domains.join(', ')}. This reduces DNS/TLS overhead.`,
          'PERF_PRECONNECT_MISSING',
          vscode.DiagnosticSeverity.Information
        )
      );
    }

    // Apply diagnostics to document.
    collection.set(doc.uri, diagnostics);
  }

  // Hook into open/save/change events for incremental feedback.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scanDocument),
    vscode.workspace.onDidSaveTextDocument(scanDocument),
    // PERFORMANCE FIX: Debounce real-time scanning (300ms delay)
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        scanDocument(e.document);
      }, 300);
    })
  );

  // Provide a command to scan the entire workspace on demand.
  context.subscriptions.push(
    vscode.commands.registerCommand('kanmi.scan', async () => {
      // PERFORMANCE FIX: Add progress notification for better UX
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Kanmi Levers Guard",
        cancellable: true
      }, async (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => {
        // Limit scanning to reasonably sized workspaces.
        const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,html}', '**/node_modules/**', 5000);

        progress.report({ message: `Scanning ${files.length} files...` });

        for (let i = 0; i < files.length; i++) {
          if (token.isCancellationRequested) {
            vscode.window.showWarningMessage('Kanmi scan cancelled.');
            return;
          }

          const file = files[i];
          const doc = await vscode.workspace.openTextDocument(file);
          await scanDocument(doc);

          // Update progress every 10 files
          if (i % 10 === 0) {
            const percent = ((i / files.length) * 100).toFixed(0);
            progress.report({
              message: `${i}/${files.length} files (${percent}%)`,
              increment: (10 / files.length) * 100
            });
          }
        }

        vscode.window.showInformationMessage(`Kanmi Levers Guard: Scanned ${files.length} files.`);
      });
    })
  );
}

export function deactivate() {
  // nothing to clean up
}
