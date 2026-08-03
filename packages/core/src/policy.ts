import type { Finding } from './finding';

export interface Policy {
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

const RULE_ALIASES: Record<string, string[]> = {
  PERF_DOM_SIZE_HEURISTIC: ['WRS_DOM_SIZE_WARNING'],
  PERF_DOM_SIZE_HEURISTIC_HIGH: ['WRS_DOM_SIZE_EXCEEDED'],
  PERF_DOM_DEPTH_HEURISTIC: ['WRS_DOM_DEPTH_WARNING'],
  PERF_DOM_DEPTH_HEURISTIC_HIGH: ['WRS_DOM_DEPTH_EXCEEDED'],
  PERF_JS_BUNDLE_SIZE_HEURISTIC: ['WRS_JS_BUNDLE_SIZE_WARNING'],
  PERF_JS_BUNDLE_SIZE_HEURISTIC_HIGH: ['WRS_JS_BUNDLE_SIZE_EXCEEDED'],
  PERF_SCRIPT_COUNT_POLICY: ['PERF_SCRIPT_COUNT_EXCEEDED']
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizePolicy(value: unknown): Policy {
  if (!isRecord(value)) {
    return {};
  }

  const policy: Policy = {};
  if (isRecord(value.seo)) {
    policy.seo = value.seo as Policy['seo'];
  }
  if (isRecord(value.perf)) {
    policy.perf = value.perf as Policy['perf'];
  }
  if (isRecord(value.wrs)) {
    policy.wrs = value.wrs as Policy['wrs'];
  }
  if (Array.isArray(value.disabledRules)) {
    policy.disabledRules = value.disabledRules.filter((rule): rule is string => typeof rule === 'string');
  }
  return policy;
}

export function isRuleDisabled(disabledRules: readonly string[] = [], code: string): boolean {
  return disabledRules.includes(code) || (RULE_ALIASES[code] ?? []).some(alias => disabledRules.includes(alias));
}

export function filterDisabledFindings<T extends Finding>(findings: readonly T[], disabledRules: readonly string[] = []): T[] {
  if (!disabledRules.length) {
    return [...findings];
  }
  return findings.filter(finding => !isRuleDisabled(disabledRules, finding.code));
}