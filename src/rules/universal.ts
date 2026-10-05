export type UniversalSeverity = 'warning' | 'info';

export interface UniversalFinding {
  code: string;
  severity: UniversalSeverity;
  message: string;
  offset: number;
  length?: number;
  evidence?: Record<string, unknown>;
}

export interface UniversalRulePolicy {
  perf?: {
    maxThirdPartyScriptsPerPage?: number;
    requireImageLazyLoading?: boolean;
  };
  disabledRules?: string[];
}

const RULE_ALIASES: Record<string, string[]> = {
  PERF_SCRIPT_COUNT_POLICY: ['PERF_SCRIPT_COUNT_EXCEEDED']
};

function isRuleDisabled(policy: UniversalRulePolicy, code: string): boolean {
  const disabled = policy.disabledRules ?? [];
  return disabled.includes(code) || (RULE_ALIASES[code] ?? []).some(alias => disabled.includes(alias));
}

function pushFinding(
  findings: UniversalFinding[],
  policy: UniversalRulePolicy,
  finding: UniversalFinding
): void {
  if (!isRuleDisabled(policy, finding.code)) {
    findings.push(finding);
  }
}

function scanImageRules(text: string, policy: UniversalRulePolicy): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const imageRegex = /<img\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(text)) !== null) {
    const attrs = match[1];
    const hasAlt = /\balt\s*=/.test(attrs);
    const hasWidth = /\bwidth\s*=/.test(attrs);
    const hasHeight = /\bheight\s*=/.test(attrs);
    const hasLoading = /\bloading\s*=\s*["'](?:lazy|eager)["']/i.test(attrs);

    if (!hasAlt) {
      pushFinding(findings, policy, {
        code: 'SEO_IMG_ALT_MISSING',
        severity: 'warning',
        message: 'Image missing alt attribute. Add a meaningful `alt` for accessibility and SEO.',
        offset: match.index,
        length: match[0].length,
        evidence: { element: 'img' }
      });
    }

    if (!hasWidth || !hasHeight) {
      pushFinding(findings, policy, {
        code: 'PERF_IMG_DIMENSIONS_MISSING',
        severity: 'warning',
        message: 'Image missing width/height attributes. Explicit dimensions prevent layout shift.',
        offset: match.index,
        length: match[0].length,
        evidence: { hasWidth, hasHeight }
      });
    }

    if (policy.perf?.requireImageLazyLoading && !hasLoading) {
      pushFinding(findings, policy, {
        code: 'PERF_IMG_LOADING_MISSING',
        severity: 'info',
        message: 'Consider adding loading="lazy" to defer off-screen images.',
        offset: match.index,
        length: match[0].length,
        evidence: { element: 'img' }
      });
    }
  }

  return findings;
}

function scanScriptRules(text: string, policy: UniversalRulePolicy): UniversalFinding[] {
  const findings: UniversalFinding[] = [];
  const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  let thirdPartyScriptCount = 0;

  while ((match = scriptRegex.exec(text)) !== null) {
    const tag = match[0];
    const src = match[1];
    const hasAsyncOrDefer = /\basync\b/i.test(tag) || /\bdefer\b/i.test(tag);
    const isModule = /\btype\s*=\s*["']module["']/i.test(tag);

    if (/^(?:https?:)?\/\//i.test(src)) {
      thirdPartyScriptCount++;
    }

    if (!hasAsyncOrDefer && !isModule) {
      pushFinding(findings, policy, {
        code: 'PERF_SCRIPT_BLOCKING',
        severity: 'warning',
        message: 'Script tag without `async`, `defer`, or `type="module"` can block rendering.',
        offset: match.index,
        length: match[0].length,
        evidence: { src }
      });
    }
  }

  const maxThirdPartyScripts = policy.perf?.maxThirdPartyScriptsPerPage ?? 6;
  if (thirdPartyScriptCount > maxThirdPartyScripts) {
    pushFinding(findings, policy, {
      code: 'PERF_SCRIPT_COUNT_POLICY',
      severity: 'warning',
      message: `Document contains ${thirdPartyScriptCount} third-party script tags. This exceeds the configured Kanmi policy budget of ${maxThirdPartyScripts}.`,
      offset: 0,
      evidence: { thirdPartyScriptCount, maxThirdPartyScripts }
    });
  }

  return findings;
}

export function scanUniversalSourceRules(
  text: string,
  policy: UniversalRulePolicy = {}
): UniversalFinding[] {
  return [
    ...scanImageRules(text, policy),
    ...scanScriptRules(text, policy)
  ];
}
