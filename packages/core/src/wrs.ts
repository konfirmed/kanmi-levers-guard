import * as path from 'path';
import type { Finding } from './finding';

export const WRS_FETCH_LIMIT_BYTES = 2_000_000;
export const WRS_DEFAULT_NEAR_LIMIT_BYTES = 1_500_000;
export const PDF_FETCH_LIMIT_BYTES = 64_000_000;

export type WrsResourceKind = 'html' | 'css' | 'js' | 'json' | 'pdf';
export type WrsClassification =
  | 'documented-platform-behaviour'
  | 'measured-production-fact'
  | 'static-approximation'
  | 'kanmi-heuristic';

export type WrsFinding = Finding;

export interface ProductionArtifactScanOptions {
  nearLimitBytes: number;
  artifactRoot: string;
  robotsText?: string;
}

interface ResourceReference {
  value: string;
  offset: number;
}

interface RobotsRule {
  pattern: string;
  allow: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(2)} MB`;
  }
  return `${Math.round(bytes / 1_000)} KB`;
}

function createFinding(
  code: string,
  severity: WrsFinding['severity'],
  message: string,
  offset?: number
): WrsFinding {
  return {
    code,
    severity,
    message,
    classification: getClassification(code),
    evidence: {
      ruleId: code,
      offset
    },
    offset
  };
}

function getClassification(code: string): WrsClassification {
  if (code === 'PERF_PDF_SIZE_EXCEEDED') {
    return 'measured-production-fact';
  }
  if (code === 'wrs/resource-over-2mb' || code === 'wrs/resource-near-limit' || code === 'wrs/source-size-estimate' || code === 'wrs/critical-content-after-cutoff') {
    return 'static-approximation';
  }
  if (code.startsWith('wrs/')) {
    return 'documented-platform-behaviour';
  }
  return 'kanmi-heuristic';
}

export function shouldScanProductionArtifactPath(filePath: string): boolean {
  const normalizedPath = `/${filePath.split(path.sep).join('/')}`;
  if (/\/(?:node_modules|\.git)(?:\/|$)/.test(normalizedPath)) {
    return false;
  }
  return Boolean(getWrsResourceKind(filePath));
}

function firstMatchOffset(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match?.index;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isLocalReference(reference: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference);
}

function resolveLocalReference(
  reference: string,
  filePath: string,
  artifactRoot: string
): { filePath: string; urlPath: string } | undefined {
  if (!isLocalReference(reference)) {
    return undefined;
  }

  const cleanReference = reference.split(/[?#]/, 1)[0];
  if (!cleanReference) {
    return undefined;
  }

  let decodedReference: string;
  try {
    decodedReference = decodeURIComponent(cleanReference);
  } catch {
    decodedReference = cleanReference;
  }

  const candidate = path.resolve(
    decodedReference.startsWith('/')
      ? artifactRoot
      : path.dirname(filePath),
    decodedReference.startsWith('/') ? `.${decodedReference}` : decodedReference
  );
  if (!isWithin(artifactRoot, candidate)) {
    return undefined;
  }

  const relative = path.relative(artifactRoot, candidate).split(path.sep).join('/');
  return {
    filePath: candidate,
    urlPath: `/${relative}`
  };
}

function isFingerprintedReference(reference: string): boolean {
  const query = reference.split('?')[1]?.split('#')[0] ?? '';
  if (/(?:^|&)(?:v|ver|version|hash|rev)=[a-z0-9_-]{6,}(?:&|$)/i.test(query)) {
    return true;
  }

  const cleanReference = reference.split(/[?#]/, 1)[0];
  const basename = path.basename(cleanReference);
  const stem = basename.replace(/\.(?:m?js|cjs|css)$/i, '');
  return /(?:^|[-._])[a-f0-9]{8,}(?:$|[-._])/i.test(stem);
}

function collectResourceReferences(text: string): ResourceReference[] {
  const references: ResourceReference[] = [];
  const tagRegex = /<(?:script|link)\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(text)) !== null) {
    const tag = tagMatch[0];
    const tagName = /^<([a-z]+)/i.exec(tag)?.[1]?.toLowerCase();
    const isStylesheet = tagName === 'link' && /\brel\s*=\s*["'][^"']*\bstylesheet\b/i.test(tag);
    if (tagName !== 'script' && !isStylesheet) {
      continue;
    }

    const attributeName = tagName === 'script' ? 'src' : 'href';
    const attributeMatch = new RegExp(`\\b${attributeName}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
    if (attributeMatch?.[1]) {
      references.push({
        value: attributeMatch[1],
        offset: tagMatch.index
      });
    }
  }

  const fetchRegex = /\bfetch\s*\(\s*["']([^"']+)["']/gi;
  let fetchMatch: RegExpExecArray | null;
  while ((fetchMatch = fetchRegex.exec(text)) !== null) {
    references.push({
      value: fetchMatch[1],
      offset: fetchMatch.index
    });
  }

  return references;
}

function parseRobotsRules(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let groupRelevant = false;
  let inUserAgentBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) {
      continue;
    }

    const userAgentMatch = /^user-agent\s*:\s*(.+)$/i.exec(line);
    if (userAgentMatch) {
      if (!inUserAgentBlock) {
        groupRelevant = false;
      }
      const userAgent = userAgentMatch[1].trim().toLowerCase();
      groupRelevant = groupRelevant || userAgent === '*' || userAgent.includes('googlebot');
      inUserAgentBlock = true;
      continue;
    }

    const ruleMatch = /^(allow|disallow)\s*:\s*(.*)$/i.exec(line);
    if (ruleMatch && inUserAgentBlock && groupRelevant) {
      const pattern = ruleMatch[2].trim();
      if (pattern) {
        rules.push({
          pattern,
          allow: ruleMatch[1].toLowerCase() === 'allow'
        });
      }
      continue;
    }

    inUserAgentBlock = false;
    groupRelevant = false;
  }

  return rules;
}

function robotsPatternMatches(pattern: string, urlPath: string): boolean {
  const endAnchored = pattern.endsWith('$');
  const sourcePattern = endAnchored ? pattern.slice(0, -1) : pattern;
  const escapedPattern = sourcePattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escapedPattern}${endAnchored ? '$' : ''}`).test(urlPath);
}

function isBlockedByRobots(urlPath: string, rules: RobotsRule[]): boolean {
  const matchingRules = rules
    .filter(rule => robotsPatternMatches(rule.pattern, urlPath))
    .sort((left, right) => {
      const lengthDifference = right.pattern.length - left.pattern.length;
      return lengthDifference || Number(right.allow) - Number(left.allow);
    });
  return matchingRules.length > 0 && !matchingRules[0].allow;
}

function scanCriticalContentAfterCutoff(text: string): WrsFinding[] {
  const criticalMarkers = [
    { label: 'title', pattern: /<title\b/i },
    { label: 'meta description', pattern: /<meta\b[^>]*\bname\s*=\s*["']description["']/i },
    { label: 'canonical link', pattern: /<link\b[^>]*\brel\s*=\s*["'][^"']*\bcanonical\b/i },
    { label: 'robots directive', pattern: /<meta\b[^>]*\bname\s*=\s*["'](?:robots|googlebot)["']/i },
    { label: 'structured data', pattern: /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["']/i },
    { label: 'main content', pattern: /<(?:main|article|h1)\b/i },
    { label: 'script reference', pattern: /<script\b[^>]*\bsrc\s*=/i },
    { label: 'critical stylesheet', pattern: /<link\b[^>]*\brel\s*=\s*["'][^"']*\bstylesheet\b/i }
  ];
  const lateMarkers: Array<{ label: string; offset: number; byteOffset: number }> = [];

  for (const marker of criticalMarkers) {
    const offset = firstMatchOffset(text, marker.pattern);
    if (offset === undefined) {
      continue;
    }

    const byteOffset = Buffer.byteLength(text.slice(0, offset), 'utf8');
    if (byteOffset >= WRS_FETCH_LIMIT_BYTES) {
      lateMarkers.push({ label: marker.label, offset, byteOffset });
    }
  }

  if (!lateMarkers.length) {
    return [];
  }

  const labels = lateMarkers.map(marker => marker.label).join(', ');
  const firstMarker = lateMarkers[0];
  return [
    createFinding(
      'wrs/critical-content-after-cutoff',
      'error',
      `Critical content (${labels}) begins at byte ${firstMarker.byteOffset}, after Googlebot's 2,000,000-byte per-URL cutoff. Content beyond the cutoff is not fetched, rendered, or indexed. Verify the production uncompressed HTTP response, including headers.`,
      firstMarker.offset
    )
  ];
}

function scanUnfingerprintedAssets(
  text: string,
  filePath: string,
  artifactRoot: string
): WrsFinding[] {
  const stableReferences = collectResourceReferences(text)
    .filter(reference => /\.(?:m?js|cjs|css)(?:[?#]|$)/i.test(reference.value))
    .filter(reference => !isFingerprintedReference(reference.value))
    .filter(reference => resolveLocalReference(reference.value, filePath, artifactRoot));

  if (!stableReferences.length) {
    return [];
  }

  const names = Array.from(new Set(stableReferences.map(reference => path.basename(reference.value.split(/[?#]/, 1)[0]))));
  return [
    createFinding(
      'wrs/unfingerprinted-assets',
      'warning',
      `Production references stable JS/CSS filenames (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', ...' : ''}). Use fingerprinted asset filenames for mutable resources because WRS may cache resources for up to approximately 30 days.`,
      stableReferences[0].offset
    )
  ];
}

function scanBlockedCriticalResources(
  text: string,
  filePath: string,
  artifactRoot: string,
  robotsText?: string
): WrsFinding[] {
  if (!robotsText) {
    return [];
  }

  const rules = parseRobotsRules(robotsText);
  const blockedReferences = collectResourceReferences(text)
    .map(reference => {
      const resolved = resolveLocalReference(reference.value, filePath, artifactRoot);
      if (!resolved || !isBlockedByRobots(resolved.urlPath, rules)) {
        return undefined;
      }
      return { reference, urlPath: resolved.urlPath };
    })
    .filter((value): value is { reference: ResourceReference; urlPath: string } => Boolean(value));

  if (!blockedReferences.length) {
    return [];
  }

  const paths = Array.from(new Set(blockedReferences.map(reference => reference.urlPath)));
  return [
    createFinding(
      'wrs/blocked-critical-resource',
      'error',
      `Rendering-critical resource(s) appear blocked by robots.txt: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', ...' : ''}. Do not block required CSS, JavaScript, or API resources from Googlebot.`,
      blockedReferences[0].reference.offset
    )
  ];
}

export function getWrsResourceKind(filePath: string): WrsResourceKind | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'html';
    case '.css':
      return 'css';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'js';
    case '.json':
      return 'json';
    case '.pdf':
      return 'pdf';
    default:
      return undefined;
  }
}

export function scanSourceSize(bytes: number, nearLimitBytes: number): WrsFinding[] {
  if (bytes <= nearLimitBytes) {
    return [];
  }

  return [
    createFinding(
      'wrs/source-size-estimate',
      'warning',
      `Static source estimate is ${formatBytes(bytes)}. Verify the production uncompressed HTTP response; HTTP headers count toward Googlebot's 2,000,000-byte per-URL ceiling.`,
      0
    )
  ];
}

export function scanWrsBehaviorRules(text: string): WrsFinding[] {
  const findings: WrsFinding[] = [];
  const interactionMatch = /\b(?:on(?:Click|Scroll|MouseEnter|MouseOver|KeyDown|Change|Submit|TouchStart|PointerDown)|addEventListener)\b/i.exec(text);
  const contentMutationMatch = /\b(?:set[A-Z][A-Za-z0-9_]*|setState|innerHTML|textContent|appendChild|insertAdjacentHTML|document\.write|fetch\s*\()/i.exec(text);
  if (interactionMatch && contentMutationMatch) {
    findings.push(
      createFinding(
        'wrs/interaction-dependent-content',
        'warning',
        'Indexable content may be created or fetched only from a click, scroll, hover, keyboard, or other user-gesture handler. Google does not interact with pages during WRS; render essential content without user interaction.',
        interactionMatch.index
      )
    );
  }

  const persistedStateMatch = /\b(?:document\.cookie|localStorage|sessionStorage|cookieStore\b|cookies\s*\(\s*\))/i.exec(text);
  if (persistedStateMatch) {
    findings.push(
      createFinding(
        'wrs/persisted-state-dependency',
        'warning',
        'Initial content appears to depend on cookies, localStorage, or sessionStorage. WRS clears persisted client state between page loads; provide indexable content without a previous session.',
        persistedStateMatch.index
      )
    );
  }

  const unsupportedTransportMatch = /\b(?:new\s+WebSocket|WebSocket\s*\(|wss:\/\/|RTCPeerConnection|RTCDataChannel|RTCIceCandidate)\b/i.exec(text);
  if (unsupportedTransportMatch) {
    findings.push(
      createFinding(
        'wrs/unsupported-content-transport',
        'error',
        'Essential content appears to depend on WebSocket or WebRTC transport. These are not supported as WRS content-retrieval mechanisms; provide an HTTP fallback.',
        unsupportedTransportMatch.index
      )
    );
  }

  const permissionMatch = /\b(?:navigator\.(?:geolocation|mediaDevices|permissions)|getUserMedia|requestPermission|requestDevice)\s*\(?/i.exec(text);
  if (permissionMatch) {
    findings.push(
      createFinding(
        'wrs/permission-gated-content',
        'error',
        'Primary content may require a browser permission such as location, camera, microphone, notifications, or device access. Google declines permission requests during rendering; expose essential content without the permission gate.',
        permissionMatch.index
      )
    );
  }

  const webglMatch = /\b(?:WebGL(?:2)?RenderingContext|canvas\.getContext\s*\(\s*["']webgl2?["']|getContext\s*\(\s*["']webgl2?["'])/i.exec(text);
  if (webglMatch) {
    findings.push(
      createFinding(
        'wrs/webgl-only-content',
        'warning',
        'Meaningful content appears to depend on WebGL output. WRS does not support WebGL as a reliable source of indexable content; provide equivalent text or HTML.',
        webglMatch.index
      )
    );
  }

  const non200Match = /\b(?:statusCode|status)\s*[:=]\s*(?:30[0-9]|40[0-9]|50[0-9])\b|\b(?:redirect|notFound)\s*\(/i.exec(text);
  const clientIndexabilityMatch = /\b(?:useEffect|useLayoutEffect|window\.location|location\.(?:replace|assign)|router\.(?:push|replace)|document\.|fetch\s*\()/i.exec(text);
  if (non200Match && clientIndexabilityMatch) {
    findings.push(
      createFinding(
        'wrs/non-200-render-dependency',
        'warning',
        'An error or redirect response appears to rely on JavaScript to establish indexable content. Non-200 responses may not be rendered by WRS; return the intended indexability from the correct HTTP response.',
        non200Match.index
      )
    );
  }

  const userAgentVersionMatch = /(?:Googlebot|user[-_ ]?agent|navigator\.userAgent)[\s\S]{0,160}(?:Chrome|Chromium|HeadlessChrome)\/\d+|(?:Chrome|Chromium|HeadlessChrome)\/\d+[\s\S]{0,160}(?:Googlebot|user[-_ ]?agent|navigator\.userAgent)/i.exec(text);
  if (userAgentVersionMatch) {
    findings.push(
      createFinding(
        'wrs/user-agent-version-assumption',
        'warning',
        'Code branches on a hard-coded Googlebot or Chromium version. WRS uses an evergreen Chromium version; feature-detect behavior instead of targeting a frozen browser version.',
        userAgentVersionMatch.index
      )
    );
  }

  return findings;
}

export function scanProductionArtifact(
  filePath: string,
  content: Buffer,
  options: ProductionArtifactScanOptions
): WrsFinding[] {
  const kind = getWrsResourceKind(filePath);
  if (!kind) {
    return [];
  }

  if (kind === 'pdf') {
    return content.length >= PDF_FETCH_LIMIT_BYTES
      ? [
          createFinding(
            'PERF_PDF_SIZE_EXCEEDED',
            'error',
            `PDF artifact is ${formatBytes(content.length)}. Keep PDF responses below the separate 64 MB document limit; this is not a WRS HTML, CSS, JavaScript, or XHR limit.`,
            0
          )
        ]
      : [];
  }

  const findings: WrsFinding[] = [];
  if (content.length >= WRS_FETCH_LIMIT_BYTES) {
    findings.push(
      createFinding(
        'wrs/resource-over-2mb',
        'error',
        `Production ${kind.toUpperCase()} artifact is ${formatBytes(content.length)} of uncompressed body bytes. Googlebot's 2,000,000-byte fetch ceiling applies separately to each URL and includes HTTP headers; this resource exceeds the ceiling.`,
        0
      )
    );
  } else if (content.length > options.nearLimitBytes) {
    findings.push(
      createFinding(
        'wrs/resource-near-limit',
        'warning',
        `Production ${kind.toUpperCase()} artifact is ${formatBytes(content.length)} of uncompressed body bytes, above the ${formatBytes(options.nearLimitBytes)} safety threshold. Static artifact size excludes HTTP headers; verify the production uncompressed HTTP response.`,
        0
      )
    );
  }

  const text = content.toString('utf8');
  findings.push(...scanWrsBehaviorRules(text));

  if (kind === 'html') {
    if (content.length > WRS_FETCH_LIMIT_BYTES) {
      findings.push(...scanCriticalContentAfterCutoff(text));
    }
    findings.push(...scanUnfingerprintedAssets(text, filePath, options.artifactRoot));
    findings.push(...scanBlockedCriticalResources(text, filePath, options.artifactRoot, options.robotsText));
  }

  return findings;
}