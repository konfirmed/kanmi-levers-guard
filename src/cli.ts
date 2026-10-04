#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PRODUCTION_ARTIFACT_PATHS,
  GuardFailOn,
  GuardPolicy,
  readGuardPolicy,
  resolveWrsNearLimitBytes,
  scanProductionGuard,
  shouldFailGuard
} from './core';
import { shouldScanProductionArtifactPath, WrsFinding } from './wrs';

interface CliOptions {
  workspaceRoot: string;
  artifactPaths: string[];
  failOn: GuardFailOn;
  json: boolean;
}

interface GuardResult {
  file: string;
  findings: WrsFinding[];
}

function parseArgs(argv: string[]): CliOptions {
  let workspaceRoot = process.cwd();
  let failOn: GuardFailOn = 'error';
  let json = false;
  const artifactPaths: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--root') {
      workspaceRoot = path.resolve(argv[++index] ?? '.');
    } else if (arg === '--path') {
      const value = argv[++index];
      if (!value) throw new Error('--path requires a value.');
      artifactPaths.push(value);
    } else if (arg === '--fail-on') {
      const value = argv[++index];
      if (value !== 'error' && value !== 'warning') {
        throw new Error('--fail-on must be "error" or "warning".');
      }
      failOn = value;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === 'check') {
      continue;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { workspaceRoot, artifactPaths, failOn, json };
}

function printHelp(): void {
  console.log(`Kanmi Levers Guard CLI\n\nUsage:\n  kanmi-guard check [options]\n\nOptions:\n  --root <path>          Workspace root (default: current directory)\n  --path <path>          Production artifact path; repeatable\n  --fail-on <level>      error | warning (default: error)\n  --json                 Emit machine-readable JSON\n  -h, --help             Show help\n`);
}

function collectFiles(target: string, files: string[]): void {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (shouldScanProductionArtifactPath(target)) files.push(target);
    return;
  }

  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    collectFiles(path.join(target, entry.name), files);
  }
}

function readRobotsText(artifactRoot: string, workspaceRoot: string): string | undefined {
  const candidates = [
    path.join(artifactRoot, 'robots.txt'),
    path.join(workspaceRoot, 'robots.txt'),
    path.join(workspaceRoot, 'public', 'robots.txt')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return undefined;
}

function run(options: CliOptions): GuardResult[] {
  const policy: GuardPolicy = readGuardPolicy(options.workspaceRoot);
  const configuredPaths = options.artifactPaths.length
    ? options.artifactPaths
    : (policy.wrs?.productionArtifactPaths ?? DEFAULT_PRODUCTION_ARTIFACT_PATHS);
  const nearLimitBytes = resolveWrsNearLimitBytes(policy);
  const results: GuardResult[] = [];

  for (const configuredPath of configuredPaths) {
    const artifactRoot = path.resolve(options.workspaceRoot, configuredPath);
    const files: string[] = [];
    collectFiles(artifactRoot, files);
    const robotsText = readRobotsText(artifactRoot, options.workspaceRoot);

    for (const file of files) {
      const findings = scanProductionGuard(
        file,
        fs.readFileSync(file),
        { artifactRoot, robotsText, nearLimitBytes },
        policy
      );
      if (findings.length) {
        results.push({ file: path.relative(options.workspaceRoot, file), findings });
      }
    }
  }

  return results;
}

function printHuman(results: GuardResult[]): void {
  if (!results.length) {
    console.log('✓ Kanmi Guard passed: no findings.');
    return;
  }

  for (const result of results) {
    console.log(`\n${result.file}`);
    for (const finding of result.findings) {
      const marker = finding.severity === 'error' ? '✗' : '!';
      console.log(`  ${marker} [${finding.code}] ${finding.message}`);
    }
  }

  const findings = results.flatMap(result => result.findings);
  const errors = findings.filter(finding => finding.severity === 'error').length;
  const warnings = findings.length - errors;
  console.log(`\nKanmi Guard: ${errors} error(s), ${warnings} warning(s).`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const results = run(options);
  const findings = results.flatMap(result => result.findings);

  if (options.json) {
    console.log(JSON.stringify({ results, summary: {
      errors: findings.filter(finding => finding.severity === 'error').length,
      warnings: findings.filter(finding => finding.severity === 'warning').length
    } }, null, 2));
  } else {
    printHuman(results);
  }

  process.exitCode = shouldFailGuard(findings, options.failOn) ? 1 : 0;
} catch (error) {
  console.error(`Kanmi Guard failed to run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
