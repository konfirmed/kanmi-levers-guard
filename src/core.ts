import * as fs from 'fs';
import * as path from 'path';
import {
  filterDisabledFindings,
  getWrsResourceKind,
  scanProductionArtifact,
  scanSourceSize,
  scanWrsBehaviorRules,
  WRS_DEFAULT_NEAR_LIMIT_BYTES,
  WRS_FETCH_LIMIT_BYTES,
  WrsFinding
} from './wrs';
import {
  scanUniversalSourceRules,
  UniversalFinding
} from './rules/universal';

export type GuardFailOn = 'error' | 'warning';
export type GuardFinding = WrsFinding | UniversalFinding;

export interface GuardPolicy {
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

export interface ProductionGuardOptions {
  nearLimitBytes?: number;
  artifactRoot: string;
  robotsText?: string;
}

export const DEFAULT_PRODUCTION_ARTIFACT_PATHS = [
  'dist',
  'build',
  'out',
  'public',
  '.next',
  'artifacts'
];

export function resolveWrsNearLimitBytes(
  policy: GuardPolicy = {},
  fallback = WRS_DEFAULT_NEAR_LIMIT_BYTES
): number {
  const configured = policy.wrs?.resourceNearLimitBytes ?? fallback;
  const value = Number.isFinite(configured) ? Math.round(configured) : WRS_DEFAULT_NEAR_LIMIT_BYTES;
  return Math.min(Math.max(value, 1), WRS_FETCH_LIMIT_BYTES - 1);
}

export function readGuardPolicy(workspaceRoot: string): GuardPolicy {
  const policyPath = path.join(workspaceRoot, 'kanmi.policy.json');
  if (!fs.existsSync(policyPath)) {
    return {};
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('kanmi.policy.json must contain a JSON object.');
  }

  return parsed as GuardPolicy;
}

export function scanSourceGuard(
  text: string,
  policy: GuardPolicy = {},
  nearLimitBytes = resolveWrsNearLimitBytes(policy)
): GuardFinding[] {
  const wrsFindings = filterDisabledFindings([
    ...scanSourceSize(Buffer.byteLength(text, 'utf8'), nearLimitBytes),
    ...scanWrsBehaviorRules(text)
  ], policy.disabledRules);

  return [
    ...wrsFindings,
    ...scanUniversalSourceRules(text, policy)
  ];
}

export function scanProductionGuard(
  filePath: string,
  content: Buffer,
  options: ProductionGuardOptions,
  policy: GuardPolicy = {}
): GuardFinding[] {
  const findings: GuardFinding[] = filterDisabledFindings(scanProductionArtifact(filePath, content, {
    nearLimitBytes: options.nearLimitBytes ?? resolveWrsNearLimitBytes(policy),
    artifactRoot: options.artifactRoot,
    robotsText: options.robotsText
  }), policy.disabledRules);

  if (getWrsResourceKind(filePath) === 'html') {
    findings.push(...scanUniversalSourceRules(content.toString('utf8'), policy));
  }

  return findings;
}

export function shouldFailGuard(findings: GuardFinding[], failOn: GuardFailOn = 'error'): boolean {
  if (failOn === 'warning') {
    return findings.some(finding => finding.severity === 'error' || finding.severity === 'warning');
  }
  return findings.some(finding => finding.severity === 'error');
}
