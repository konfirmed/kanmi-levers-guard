import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  filterDisabledFindings,
  getWrsResourceKind,
  scanProductionArtifact,
  scanSourceSize,
  scanWrsBehaviorRules,
  shouldScanProductionArtifactPath,
  WRS_DEFAULT_NEAR_LIMIT_BYTES,
  WRS_FETCH_LIMIT_BYTES,
  WrsFinding
} from './wrs';

const MAX_SOURCE_SCAN_BYTES = 5_000_000;
const DEFAULT_PRODUCTION_ARTIFACT_PATHS = ['dist', 'build', 'out', 'public', '.next', 'artifacts'];

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
    requireImageLazyLoading?: boolean;
  };
  wrs?: {
    resourceNearLimitBytes?: number;
    productionArtifactPaths?: string[];
  };
  disabledRules?: string[];
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
 * Helper to add a diagnostic to the array if the rule is not disabled.
 */
function addDiagnostic(
  diagnostics: vscode.Diagnostic[],
  range: vscode.Range,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity,
  policy: Policy
): void {
  // Skip if this rule is disabled
  if (isRuleDisabled(policy, code)) {
    return;
  }
  diagnostics.push(buildDiagnostic(range, message, code, severity));
}

const RULE_ALIASES: Record<string, string[]> = {
  PERF_DOM_SIZE_HEURISTIC: ['WRS_DOM_SIZE_WARNING'],
  PERF_DOM_SIZE_HEURISTIC_HIGH: ['WRS_DOM_SIZE_EXCEEDED'],
  PERF_DOM_DEPTH_HEURISTIC: ['WRS_DOM_DEPTH_WARNING'],
  PERF_DOM_DEPTH_HEURISTIC_HIGH: ['WRS_DOM_DEPTH_EXCEEDED'],
  PERF_JS_BUNDLE_SIZE_HEURISTIC: ['WRS_JS_BUNDLE_SIZE_WARNING'],
  PERF_JS_BUNDLE_SIZE_HEURISTIC_HIGH: ['WRS_JS_BUNDLE_SIZE_EXCEEDED'],
  PERF_SCRIPT_COUNT_POLICY: ['PERF_SCRIPT_COUNT_EXCEEDED']
};

function isRuleDisabled(policy: Policy, code: string): boolean {
  const disabledRules = policy.disabledRules ?? [];
  return disabledRules.includes(code) || (RULE_ALIASES[code] ?? []).some(alias => disabledRules.includes(alias));
}

function appendWrsFindings(
  findings: WrsFinding[],
  diagnostics: vscode.Diagnostic[],
  doc: vscode.TextDocument,
  policy: Policy
): void {
  for (const finding of filterDisabledFindings(findings, policy.disabledRules)) {
    const position = finding.offset === undefined
      ? new vscode.Position(0, 0)
      : doc.positionAt(finding.offset);
    const range = new vscode.Range(position, position);
    const severity = finding.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;
    addDiagnostic(
      diagnostics,
      range,
      `${finding.message} Classification: ${finding.classification}.`,
      finding.code,
      severity,
      policy
    );
  }
}

function isPathWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

  function getWrsNearLimitBytes(policy: Policy): number {
    const configuredBytes = policy.wrs?.resourceNearLimitBytes ??
      (vscode.workspace.getConfiguration().get('kanmi.wrsResourceNearLimitBytes', WRS_DEFAULT_NEAR_LIMIT_BYTES) as number);
    const nearLimitBytes = Number.isFinite(configuredBytes) ? configuredBytes : WRS_DEFAULT_NEAR_LIMIT_BYTES;
    return Math.min(Math.max(Math.round(nearLimitBytes), 1), WRS_FETCH_LIMIT_BYTES - 1);
  }

  function getProductionArtifactRoots(policy: Policy): string[] {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return [];
    }

    const configuredPaths = policy.wrs?.productionArtifactPaths ??
      (vscode.workspace.getConfiguration().get('kanmi.productionArtifactPaths', DEFAULT_PRODUCTION_ARTIFACT_PATHS) as string[]);
    return configuredPaths
      .filter(artifactPath => typeof artifactPath === 'string' && artifactPath.length > 0)
      .map(artifactPath => path.resolve(folder.uri.fsPath, artifactPath));
  }

  function isProductionArtifactFile(filePath: string, policy: Policy): boolean {
    return getProductionArtifactRoots(policy).some(root => isPathWithin(root, filePath));
  }

  function isExtensionInternalPath(filePath: string): boolean {
    const extensionPath = path.resolve(context.extensionPath);
    const resolvedPath = path.resolve(filePath);
    return isPathWithin(path.join(extensionPath, 'src'), resolvedPath) ||
      isPathWithin(path.join(extensionPath, 'out'), resolvedPath);
  }

  async function readRobotsText(artifactRoot: string, workspaceRoot: string): Promise<string | undefined> {
    const candidates = Array.from(new Set([
      path.join(artifactRoot, 'robots.txt'),
      path.join(workspaceRoot, 'robots.txt'),
      path.join(workspaceRoot, 'public', 'robots.txt')
    ]));

    for (const candidate of candidates) {
      try {
        const stat = await fs.promises.stat(candidate);
        if (stat.isFile()) {
          return await fs.promises.readFile(candidate, 'utf8');
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  async function scanProductionArtifactFile(filePath: string, artifactRoot: string, policy: Policy): Promise<void> {
    const resourceKind = getWrsResourceKind(filePath);
    if (!resourceKind) {
      return;
    }

    let content: Buffer;
    try {
      content = await fs.promises.readFile(filePath);
    } catch {
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? artifactRoot;
    const robotsText = resourceKind === 'html'
      ? await readRobotsText(artifactRoot, workspaceRoot)
      : undefined;
    const findings = filterDisabledFindings(scanProductionArtifact(filePath, content, {
      nearLimitBytes: getWrsNearLimitBytes(policy),
      artifactRoot,
      robotsText
    }), policy.disabledRules);
    if (!findings.length) {
      collection.delete(vscode.Uri.file(filePath));
      return;
    }

    let doc: vscode.TextDocument | undefined;
    if (resourceKind !== 'pdf') {
      try {
        doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      } catch {
        doc = undefined;
      }
    }

    const diagnostics: vscode.Diagnostic[] = [];
    for (const finding of findings) {
      const position = doc && finding.offset !== undefined
        ? doc.positionAt(finding.offset)
        : new vscode.Position(0, 0);
      const severity = finding.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;
      addDiagnostic(
        diagnostics,
        new vscode.Range(position, position),
        `${finding.message} Classification: ${finding.classification}.`,
        finding.code,
        severity,
        policy
      );
    }
    collection.set(vscode.Uri.file(filePath), diagnostics);
  }

  async function collectProductionArtifactFiles(
    directory: string,
    artifactRoot: string,
    files: Array<{ filePath: string; artifactRoot: string }>,
    limit: number
  ): Promise<void> {
    if (files.length >= limit) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= limit || entry.name === 'node_modules' || entry.name === '.git') {
        return;
      }

      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await collectProductionArtifactFiles(filePath, artifactRoot, files, limit);
      } else if (entry.isFile() && shouldScanProductionArtifactPath(filePath) && !isExtensionInternalPath(filePath)) {
        files.push({ filePath, artifactRoot });
      }
    }
  }

  /**
   * Context-aware HTML head rules for traditional HTML files
   */
  function scanHtmlHeadRules(text: string, doc: vscode.TextDocument, diagnostics: vscode.Diagnostic[], policy: Policy) {
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
    } else if (/<head>/i.test(text)) {
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

    // Meta description for HTML
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

    // Canonical link for HTML
    const requireCanonical = policy.seo?.requireCanonical ?? 
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
  }

  /**
   * Context-aware Next.js Head component rules
   */
  function scanNextJsHeadRules(text: string, doc: vscode.TextDocument, diagnostics: vscode.Diagnostic[], policy: Policy) {
    const hasHeadComponent = /<Head[^>]*>/.test(text) || /<head_[a-zA-Z0-9]+\.default[^>]*>/.test(text);
    if (!hasHeadComponent) return;

    // Extract content within <Head> or <head_1.default> tags
    const headContentRegex = /<Head[^>]*>([\s\S]*?)<\/Head>|<head_[a-zA-Z0-9]+\.default[^>]*>([\s\S]*?)<\/head_[a-zA-Z0-9]+\.default>/i;
    const headContentMatch = headContentRegex.exec(text);
    const headContent = headContentMatch ? (headContentMatch[1] || headContentMatch[2]) : '';

    // Check for title in Next.js Head
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(headContent);
    const titleMin = policy.seo?.titleMin ?? 30;
    const titleMax = policy.seo?.titleMax ?? 60;

    if (titleMatch) {
      const title = titleMatch[1].trim();

      // Skip validation if title contains JSX expressions (dynamic content)
      const hasJsxExpression = /\{[\s\S]*?\}/.test(title);
      if (hasJsxExpression) {
        // Title is dynamic - we can't validate its length statically
        return;
      }

      const actualIndex = headContentMatch!.index + headContentMatch![0].indexOf(titleMatch[0]);
      const start = doc.positionAt(actualIndex);
      const end = doc.positionAt(actualIndex + titleMatch[0].length);
      const range = new vscode.Range(start, end);
      if (!within(title.length, titleMin, titleMax)) {
        diagnostics.push(
          buildDiagnostic(
            range,
            `Next.js title length is ${title.length} characters; aim for ${titleMin}–${titleMax} characters.`,
            'SEO_NEXTJS_TITLE_LENGTH',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    } else {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      diagnostics.push(
        buildDiagnostic(
          range,
          'Missing <title> in Next.js <Head>. Add a focused title for SEO.',
          'SEO_NEXTJS_TITLE_MISSING',
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    // Check for meta description in Next.js Head
    // Support both string literals and JSX expressions: content="..." or content={...}
    const metaDescMatch = /<meta\s+name=["']description["']\s+content=(?:["']([^"']+)["']|\{[^}]*\})[^>]*>/i.exec(headContent);
    const descMin = policy.seo?.metaDescriptionMin ?? 50;
    const descMax = policy.seo?.metaDescriptionMax ?? 160;

    if (metaDescMatch) {
      const desc = metaDescMatch[1]?.trim();

      // Skip validation if description is a JSX expression (dynamic content)
      if (!desc) {
        // Description is dynamic (content={...}), skip validation
        // Continue to check other rules
      } else {
        const actualIndex = headContentMatch!.index + headContentMatch![0].indexOf(metaDescMatch[0]);
        const start = doc.positionAt(actualIndex);
        const end = doc.positionAt(actualIndex + metaDescMatch[0].length);
        const range = new vscode.Range(start, end);
        if (!within(desc.length, descMin, descMax)) {
          diagnostics.push(
            buildDiagnostic(
              range,
              `Next.js meta description is ${desc.length} characters; aim for ${descMin}–${descMax} characters.`,
              'SEO_NEXTJS_META_DESC_LENGTH',
              vscode.DiagnosticSeverity.Information
            )
          );
        }
      }
    } else {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      diagnostics.push(
        buildDiagnostic(
          range,
          'Missing meta description in Next.js <Head>. Add a 50–160 character description.',
          'SEO_NEXTJS_META_DESC_MISSING',
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    // Check for canonical link in Next.js Head
    const requireCanonical = policy.seo?.requireCanonical ?? 
      (vscode.workspace.getConfiguration().get('kanmi.requireCanonical', true) as boolean);
    if (requireCanonical) {
      const canonicalMatch = /<link\s+rel=["']canonical["']\s+href=["'][^"']+["'][^>]*>/i.exec(headContent);
      if (!canonicalMatch) {
        const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
        diagnostics.push(
          buildDiagnostic(
            range,
            'Missing canonical link in Next.js <Head>. Add <link rel="canonical" href="…"> for SEO.',
            'SEO_NEXTJS_CANONICAL_MISSING',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }
  }

  /**
   * Context-aware React Helmet rules
   */
  function scanReactHelmetRules(text: string, doc: vscode.TextDocument, diagnostics: vscode.Diagnostic[], policy: Policy) {
    const hasHelmet = /<Helmet[^>]*>/.test(text) || text.includes('react-helmet');
    if (!hasHelmet) return;

    // Similar logic to Next.js but for Helmet component
    const helmetContentRegex = /<Helmet[^>]*>([\s\S]*?)<\/Helmet>/i;
    const helmetMatch = helmetContentRegex.exec(text);
    if (!helmetMatch) return;

    const helmetContent = helmetMatch[1];
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(helmetContent);

    if (!titleMatch) {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      diagnostics.push(
        buildDiagnostic(
          range,
          'Missing <title> in React Helmet. Add a title for SEO.',
          'SEO_HELMET_TITLE_MISSING',
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
  }

  /**
   * Context-aware Next.js App Router Metadata API rules (Next.js 13+)
   */
  function scanNextJsMetadataAPI(
    text: string,
    doc: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    policy: Policy,
    isLayoutFile: boolean,
    isPageFile: boolean
  ) {
    const hasMetadataExport = /export\s+const\s+metadata\s*[:=]/.test(text);
    const hasGenerateMetadata = /export\s+(async\s+)?function\s+generateMetadata/.test(text);

    // For page files, metadata is recommended (but can be inherited from layout)
    // For layout files, metadata is optional (provides defaults)
    if (isPageFile && !hasMetadataExport && !hasGenerateMetadata) {
      // Check if there's a Head component being used (mixing patterns - not recommended)
      const hasHeadComponent = /<Head[^>]*>/.test(text);
      if (hasHeadComponent) {
        const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
        diagnostics.push(
          buildDiagnostic(
            range,
            'Using <Head> in App Router is deprecated. Use Metadata API instead: export const metadata = { title: "...", description: "..." }',
            'SEO_NEXTJS_APPDIR_USE_METADATA_API',
            vscode.DiagnosticSeverity.Warning
          )
        );
      } else {
        // Page file with no metadata - might be inheriting from layout (this is fine)
        // Only warn if there's no layout above (which we can't easily detect)
        // So we'll make this an Information-level suggestion
        const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
        diagnostics.push(
          buildDiagnostic(
            range,
            'Consider adding metadata export for SEO: export const metadata = { title: "...", description: "..." }',
            'SEO_NEXTJS_METADATA_SUGGESTION',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
    }

    // If metadata export exists, validate its structure
    if (hasMetadataExport) {
      // Extract the metadata object content
      const metadataMatch = /export\s+const\s+metadata\s*[:=]\s*(\{[\s\S]*?\n\})/m.exec(text);
      if (metadataMatch) {
        const metadataContent = metadataMatch[1];

        // Check for title
        const hasTitle = /title\s*[:=]/.test(metadataContent);
        if (!hasTitle && !isLayoutFile) {
          const metadataPos = doc.positionAt(metadataMatch.index);
          diagnostics.push(
            buildDiagnostic(
              new vscode.Range(metadataPos, metadataPos),
              'Metadata object missing title property. Add: title: "Your page title"',
              'SEO_NEXTJS_METADATA_TITLE_MISSING',
              vscode.DiagnosticSeverity.Warning
            )
          );
        }

        // Check for description
        const hasDescription = /description\s*[:=]/.test(metadataContent);
        if (!hasDescription && !isLayoutFile) {
          const metadataPos = doc.positionAt(metadataMatch.index);
          diagnostics.push(
            buildDiagnostic(
              new vscode.Range(metadataPos, metadataPos),
              'Metadata object missing description property. Add: description: "Your page description"',
              'SEO_NEXTJS_METADATA_DESC_MISSING',
              vscode.DiagnosticSeverity.Warning
            )
          );
        }
      }
    }
  }

  /**
   * Scan a single document for SEO and performance issues.
   */
  async function scanDocument(doc: vscode.TextDocument) {
    // CONTEXT DETECTION: Determine file type and framework
    const fileExt = doc.fileName.split('.').pop()?.toLowerCase();
    const isHtmlFile = fileExt === 'html';
    const isJsxFile = /\.(jsx|tsx)$/.test(doc.fileName);
    const isJsFile = /\.(js|ts)$/.test(doc.fileName);
    const isPureTypeScript = /\.(ts|js)$/.test(doc.fileName) && !isJsxFile;

    // Only process files that can have SEO/head content
    if (!isHtmlFile && !isJsxFile && !isPureTypeScript) {
      return;
    }

    // Skip node_modules
    if (doc.fileName.includes('/node_modules/') || doc.fileName.includes('\\node_modules\\')) {
      return;
    }

    const documentPath = path.resolve(doc.uri.fsPath);
    const extensionPath = path.resolve(context.extensionPath);
    if (isPathWithin(path.join(extensionPath, 'src'), documentPath) ||
        isPathWithin(path.join(extensionPath, 'out'), documentPath)) {
      return;
    }

    const text = doc.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    const policy = readPolicy();

    if (isProductionArtifactFile(documentPath, policy)) {
      return;
    }

    // Next.js App Router detection (Next.js 13+)
    const isAppRouterFile = /[\/\\]app[\/\\]/.test(doc.fileName) &&
                            (/page\.(tsx?|jsx?)$/.test(doc.fileName) ||
                             /layout\.(tsx?|jsx?)$/.test(doc.fileName) ||
                             /template\.(tsx?|jsx?)$/.test(doc.fileName));
    const isLayoutFile = /layout\.(tsx?|jsx?)$/.test(doc.fileName);
    const isPageFile = /page\.(tsx?|jsx?)$/.test(doc.fileName);

    // Metadata API detection (App Router)
    const hasMetadataExport = /export\s+const\s+metadata\s*[:=]/.test(text);
    const hasGenerateMetadata = /export\s+(async\s+)?function\s+generateMetadata/.test(text);
    const usesMetadataAPI = hasMetadataExport || hasGenerateMetadata;

    // More precise Next.js detection - look for actual Next.js imports
    const isNextJs = text.includes('next/head') ||
                     text.includes('next/image') ||
                     /from\s+["']next\//.test(text) ||  // Match: from "next/..." or from 'next/...'
                     /require\s*\(\s*["']next\//.test(text) ||  // Match: require("next/...")
                     isAppRouterFile;  // App Router files are Next.js files
    const isReact = text.includes('import React') || text.includes('from "react"') || text.includes("from 'react'");
    const hasHelmet = text.includes('react-helmet') || /<Helmet/.test(text);
    const hasNextSeo = text.includes('next-seo') || /<NextSeo/.test(text) || text.includes('NextSeo');

    // Skip pure TypeScript/JavaScript files that aren't Next.js pages/layouts
    // These are likely utility files, types, configs, etc.
    if (isPureTypeScript && !isAppRouterFile && !isNextJs && !isReact) {
      return; // Skip SEO validation for non-UI TypeScript files
    }

    const fileSizeBytes = Buffer.byteLength(text, 'utf8');
    if (!isProductionArtifactFile(documentPath, policy)) {
      appendWrsFindings(
        scanSourceSize(fileSizeBytes, getWrsNearLimitBytes(policy)),
        diagnostics,
        doc,
        policy
      );
    }
    appendWrsFindings(scanWrsBehaviorRules(text), diagnostics, doc, policy);

    if (fileSizeBytes > MAX_SOURCE_SCAN_BYTES) {
      console.log(`[Kanmi] Skipping large source file: ${doc.fileName} (${Math.round(fileSizeBytes / 1024)}KB)`);
      collection.set(doc.uri, diagnostics);
      return;
    }

    // CONTEXT-AWARE RULE APPLICATION
    if (isHtmlFile) {
      // Traditional HTML file - apply all HTML rules
      scanHtmlHeadRules(text, doc, diagnostics, policy);
    } else if (hasNextSeo && (isJsxFile || isJsFile)) {
      // Next.js with next-seo package - skip head validation (next-seo handles it)
      // next-seo provides a higher-level API that we trust
    } else if (isAppRouterFile && usesMetadataAPI) {
      // Next.js 13+ App Router with Metadata API - validate metadata object
      scanNextJsMetadataAPI(text, doc, diagnostics, policy, isLayoutFile, isPageFile);
    } else if (isAppRouterFile && !usesMetadataAPI) {
      // App Router file without Metadata API - suggest using it
      scanNextJsMetadataAPI(text, doc, diagnostics, policy, isLayoutFile, isPageFile);
    } else if (isNextJs && (isJsxFile || isJsFile)) {
      // Next.js Pages Router - apply traditional Head component rules
      scanNextJsHeadRules(text, doc, diagnostics, policy);
    } else if (hasHelmet && (isJsxFile || isJsFile)) {
      // React component with Helmet - apply Helmet specific rules
      scanReactHelmetRules(text, doc, diagnostics, policy);
    }
    // For pure JS/TS/JSX files without head management, skip head-related rules

    // Note: Title, meta description, and canonical rules are handled by context-aware functions above
    // (scanHtmlHeadRules, scanNextJsHeadRules, scanReactHelmetRules, scanNextJsMetadataAPI)

    // UNIVERSAL RULES: Apply to all file types when relevant
    
    // JSON‑LD hints: suggest adding product/article structured data when relevant keywords are present.
    const requireTypes = policy.seo?.requireJsonLdFor ?? [];
    if (requireTypes.length && (isHtmlFile || isNextJs || isReact)) {
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
    // Only check for pages that should have social sharing (HTML files or pages with head management)
    if (isHtmlFile || isNextJs || hasHelmet) {
      const ogTags = {
        'og:title': /<meta\s+property=["']og:title["']\s+content=["'][^"']+["'][^>]*>/i.test(text),
        'og:description': /<meta\s+property=["']og:description["']\s+content=["'][^"']+["'][^>]*>/i.test(text),
        'og:image': /<meta\s+property=["']og:image["']\s+content=["'][^"']+["'][^>]*>/i.test(text),
        'og:url': /<meta\s+property=["']og:url["']\s+content=["'][^"']+["'][^>]*>/i.test(text)
      };
      const missingOg = Object.entries(ogTags).filter(([_, present]) => !present).map(([tag]) => tag);
      if (missingOg.length >= 3) {
        diagnostics.push(
          buildDiagnostic(
            new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
            `Missing ${missingOg.length}/4 Open Graph tags: ${missingOg.join(', ')}. These improve social media sharing.`,
            'SEO_OG_TAGS_MISSING',
            vscode.DiagnosticSeverity.Information
          )
        );
      }
    }

    // DOM size thresholds are Kanmi performance heuristics, not Google limits.
    // Count opening tags (excluding self-closing and closing tags)
    // For JSX/TSX files, we need to be more selective to avoid counting JSX components
    let openingTags: string[] = text.match(/<[a-zA-Z][^/>]*>/g) || [];

    // Filter out common false positives in JSX/TS files
    if (isJsxFile || isJsFile) {
      openingTags = openingTags.filter(tag => {
        // Keep only lowercase HTML tags (DOM elements)
        // Exclude: <MyComponent>, <Array>, etc. (capitalized = JSX components/TypeScript)
        const tagName = tag.match(/<([a-zA-Z][a-zA-Z0-9]*)/)?.[1];
        return tagName && tagName[0] === tagName[0].toLowerCase();
      });
    }

    const totalElements = openingTags.length;

    if (totalElements > 800) {
      addDiagnostic(
        diagnostics,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        `DOM has ${totalElements} elements. This exceeds a Kanmi performance heuristic; Google does not publish a current numeric WRS DOM limit. Consider pagination or lazy loading.`,
        'PERF_DOM_SIZE_HEURISTIC',
        vscode.DiagnosticSeverity.Information,
        policy
      );
    }
    if (totalElements > 1500) {
      addDiagnostic(
        diagnostics,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        `DOM has ${totalElements} elements. This exceeds a high Kanmi performance heuristic; Google does not publish a current numeric WRS DOM limit.`,
        'PERF_DOM_SIZE_HEURISTIC_HIGH',
        vscode.DiagnosticSeverity.Warning,
        policy
      );
    }

    // DOM depth thresholds are Kanmi performance heuristics, not Google limits.
    const maxDepth = calculateMaxDOMDepth(text);
    if (maxDepth > 25) {
      addDiagnostic(
        diagnostics,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        `DOM depth is ${maxDepth} levels. This exceeds a Kanmi performance heuristic; Google does not publish a current numeric WRS DOM-depth limit. Flatten your HTML structure.`,
        'PERF_DOM_DEPTH_HEURISTIC',
        vscode.DiagnosticSeverity.Information,
        policy
      );
    }
    if (maxDepth > 32) {
      addDiagnostic(
        diagnostics,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        `DOM depth is ${maxDepth} levels. This exceeds a high Kanmi performance heuristic; Google does not publish a current numeric WRS DOM-depth limit.`,
        'PERF_DOM_DEPTH_HEURISTIC_HIGH',
        vscode.DiagnosticSeverity.Warning,
        policy
      );
    }

    // Head element ordering checks (only for HTML files)
    if (isHtmlFile) {
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
      // Only check for loading="lazy" if explicitly required in policy (default: false to reduce noise)
      const requireLazyLoading = policy.perf?.requireImageLazyLoading ?? false;
      if (requireLazyLoading && !hasLoading) {
        addDiagnostic(
          diagnostics,
          range,
          'Consider adding loading="lazy" to defer off‑screen images.',
          'PERF_IMG_LOADING_MISSING',
          vscode.DiagnosticSeverity.Information,
          policy
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

    // Bundle thresholds are Kanmi performance heuristics, not Google limits.
    if (totalEstimatedBundleSize > 500) {
      addDiagnostic(
        diagnostics,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        `Estimated JS bundle size: ~${totalEstimatedBundleSize}KB from heavy dependencies. This exceeds a Kanmi performance heuristic; Google does not publish a current numeric WRS JavaScript bundle ceiling. Consider code splitting.`,
        'PERF_JS_BUNDLE_SIZE_HEURISTIC',
        vscode.DiagnosticSeverity.Warning,
        policy
      );
    }
    if (totalEstimatedBundleSize > 1000) {
      addDiagnostic(
        diagnostics,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        `Estimated JS bundle size: ~${totalEstimatedBundleSize}KB. This exceeds a high Kanmi performance heuristic; Google does not publish a current numeric WRS JavaScript bundle ceiling. Consider code splitting.`,
        'PERF_JS_BUNDLE_SIZE_HEURISTIC_HIGH',
        vscode.DiagnosticSeverity.Warning,
        policy
      );
    }

    // Count third‑party scripts and ensure async/defer.
    const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let thirdPartyScriptCount = 0;
    let sMatch: RegExpExecArray | null;
    const externalDomains = new Set<string>();

    while ((sMatch = scriptRegex.exec(text)) !== null) {
      const tag = sMatch[0];
      const src = sMatch[1];
      const attrs = tag;
      const hasAsyncOrDefer = /\basync\b/.test(attrs) || /\bdefer\b/.test(attrs);
      const start = doc.positionAt(sMatch.index);
      const end = doc.positionAt(sMatch.index + sMatch[0].length);
      const range = new vscode.Range(start, end);

      if (/^(?:https?:)?\/\//i.test(src)) {
        thirdPartyScriptCount++;
      }

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
    if (thirdPartyScriptCount > maxTP) {
      diagnostics.push(
        buildDiagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Document contains ${thirdPartyScriptCount} third-party script tags. This exceeds the configured Kanmi policy budget of ${maxTP}; Google does not publish a current numeric request or script-count limit.`,
          'PERF_SCRIPT_COUNT_POLICY',
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

  context.subscriptions.push(
    vscode.commands.registerCommand('kanmi.scanProductionArtifacts', async () => {
      const policy = readPolicy();
      const artifactFiles: Array<{ filePath: string; artifactRoot: string }> = [];
      const roots = getProductionArtifactRoots(policy);

      for (const root of roots) {
        try {
          const stat = await fs.promises.stat(root);
          if (stat.isDirectory()) {
            await collectProductionArtifactFiles(root, root, artifactFiles, 5000);
          } else if (stat.isFile() && shouldScanProductionArtifactPath(root) && !isExtensionInternalPath(root)) {
            artifactFiles.push({ filePath: root, artifactRoot: path.dirname(root) });
          }
        } catch {
          continue;
        }
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Kanmi WRS Ruleset 2026.1',
        cancellable: true
      }, async (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => {
        progress.report({ message: `Scanning ${artifactFiles.length} production artifacts...` });

        for (let i = 0; i < artifactFiles.length; i++) {
          if (token.isCancellationRequested) {
            vscode.window.showWarningMessage('Kanmi production artifact scan cancelled.');
            return;
          }

          const artifact = artifactFiles[i];
          await scanProductionArtifactFile(artifact.filePath, artifact.artifactRoot, policy);
          progress.report({
            message: `${i + 1}/${artifactFiles.length} artifacts`,
            increment: 100 / Math.max(artifactFiles.length, 1)
          });
        }

        vscode.window.showInformationMessage(`Kanmi WRS Ruleset 2026.1: scanned ${artifactFiles.length} production artifacts.`);
      });
    })
  );
}

export function deactivate() {
  // nothing to clean up
}
