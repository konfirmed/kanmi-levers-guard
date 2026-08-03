#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  filterDisabledFindings,
  getWrsResourceKind,
  normalizePolicy,
  scanProductionArtifact,
  shouldScanProductionArtifactPath,
  WRS_DEFAULT_NEAR_LIMIT_BYTES,
  WRS_FETCH_LIMIT_BYTES
} from '@kanmi/core';
import type { Finding, Policy } from '@kanmi/core';

const DEFAULT_ARTIFACT_PATHS = ['dist', 'build', 'out', 'public', '.next', 'artifacts'];

export const EXIT_CODES = {
  clean: 0,
  warnings: 1,
  errors: 2,
  runtime: 3,
  usage: 64
} as const;

type OutputFormat = 'stylish' | 'json';

interface CliOptions {
  format: OutputFormat;
  nearLimitBytes?: number;
  disabledRules: string[];
  configPath: string;
  paths: string[];
}

interface ArtifactFile {
  filePath: string;
  artifactRoot: string;
}

export interface CliFinding extends Finding {
  filePath: string;
  line: number;
  column: number;
}

interface ScanSummary {
  filesScanned: number;
  errors: number;
  warnings: number;
}

interface JsonReport {
  version: 1;
  findings: CliFinding[];
  summary: ScanSummary;
}

function usage(): string {
  return [
    'Usage: kanmi scan [paths...] [options]',
    '',
    'Options:',
    '  --format stylish|json       Output format (default: stylish)',
    '  --near-limit-bytes N        Override the WRS warning threshold',
    '  --disable-rule RULE         Suppress a finding code; repeatable',
    '  --config PATH               Policy file (default: kanmi.policy.json)',
    '  --help                      Show this help',
    '',
    'Exit codes: 0 clean, 1 warnings, 2 errors, 3 runtime failure, 64 usage error'
  ].join('\n');
}

function parseInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer`);
  }
  return parsed;
}

function readOptionValue(args: string[], index: number, inlineValue: string | undefined, option: string): { value: string; index: number } {
  if (inlineValue !== undefined) {
    return { value: inlineValue, index };
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return { value, index: index + 1 };
}

function parseArgs(args: string[]): CliOptions | 'help' {
  if (args.includes('--help')) {
    return 'help';
  }
  if (args[0] !== 'scan') {
    throw new Error('the scan command is required');
  }

  const options: CliOptions = {
    format: 'stylish',
    disabledRules: [],
    configPath: 'kanmi.policy.json',
    paths: []
  };

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      options.paths.push(argument);
      continue;
    }

    const separator = argument.indexOf('=');
    const option = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    if (option === '--format') {
      const result = readOptionValue(args, index, inlineValue, option);
      index = result.index;
      if (result.value !== 'stylish' && result.value !== 'json') {
        throw new Error('--format must be stylish or json');
      }
      options.format = result.value;
    } else if (option === '--near-limit-bytes') {
      const result = readOptionValue(args, index, inlineValue, option);
      index = result.index;
      options.nearLimitBytes = parseInteger(result.value, option);
    } else if (option === '--disable-rule') {
      const result = readOptionValue(args, index, inlineValue, option);
      index = result.index;
      options.disabledRules.push(result.value);
    } else if (option === '--config') {
      const result = readOptionValue(args, index, inlineValue, option);
      index = result.index;
      options.configPath = result.value;
    } else {
      throw new Error(`unknown option: ${option}`);
    }
  }

  return options;
}

function loadPolicy(cwd: string, configPath: string): Policy {
  const absolutePath = path.resolve(cwd, configPath);
  try {
    return normalizePolicy(JSON.parse(fs.readFileSync(absolutePath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && configPath === 'kanmi.policy.json') {
      return {};
    }
    throw error;
  }
}

function collectArtifactFiles(inputPath: string, cwd: string): ArtifactFile[] {
  const resolvedPath = path.resolve(cwd, inputPath);
  const stat = fs.statSync(resolvedPath);
  if (stat.isFile()) {
    return shouldScanProductionArtifactPath(resolvedPath)
      ? [{ filePath: resolvedPath, artifactRoot: path.dirname(resolvedPath) }]
      : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const files: ArtifactFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && shouldScanProductionArtifactPath(filePath)) {
        files.push({ filePath, artifactRoot: resolvedPath });
      }
    }
  };
  visit(resolvedPath);
  return files;
}

function readRobotsText(artifactRoot: string, cwd: string): string | undefined {
  const candidates = Array.from(new Set([
    path.join(artifactRoot, 'robots.txt'),
    path.join(cwd, 'robots.txt'),
    path.join(cwd, 'public', 'robots.txt')
  ]));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return fs.readFileSync(candidate, 'utf8');
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function lineAndColumn(text: string, offset: number | undefined): { line: number; column: number } {
  if (offset === undefined || offset <= 0) {
    return { line: 1, column: 1 };
  }
  const prefix = text.slice(0, offset);
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function displayPath(filePath: string, cwd: string): string {
  const relative = path.relative(cwd, filePath).split(path.sep).join('/');
  return relative || path.basename(filePath);
}

function scan(options: CliOptions, policy: Policy, cwd: string): { findings: CliFinding[]; summary: ScanSummary } {
  const inputPaths = options.paths.length
    ? options.paths
    : policy.wrs?.productionArtifactPaths?.length
      ? policy.wrs.productionArtifactPaths
      : DEFAULT_ARTIFACT_PATHS;
  const files = new Map<string, ArtifactFile>();
  for (const inputPath of inputPaths) {
    for (const artifact of collectArtifactFiles(inputPath, cwd)) {
      files.set(artifact.filePath, artifact);
    }
  }

  const configuredNearLimit = options.nearLimitBytes ?? policy.wrs?.resourceNearLimitBytes ?? WRS_DEFAULT_NEAR_LIMIT_BYTES;
  const nearLimitBytes = Math.min(Math.max(Math.round(Number(configuredNearLimit)), 1), WRS_FETCH_LIMIT_BYTES - 1);
  const disabledRules = [...(policy.disabledRules ?? []), ...options.disabledRules];
  const findings: CliFinding[] = [];

  for (const artifact of files.values()) {
    const content = fs.readFileSync(artifact.filePath);
    const kind = getWrsResourceKind(artifact.filePath);
    const robotsText = kind === 'html' ? readRobotsText(artifact.artifactRoot, cwd) : undefined;
    const text = kind === 'pdf' ? '' : content.toString('utf8');
    const rawFindings = filterDisabledFindings(scanProductionArtifact(artifact.filePath, content, {
      nearLimitBytes,
      artifactRoot: artifact.artifactRoot,
      robotsText
    }), disabledRules);
    const filePath = displayPath(artifact.filePath, cwd);
    for (const finding of rawFindings) {
      const position = lineAndColumn(text, finding.offset);
      findings.push({
        ...finding,
        filePath,
        line: position.line,
        column: position.column,
        evidence: {
          ...finding.evidence,
          filePath
        }
      });
    }
  }

  findings.sort((left, right) => left.filePath.localeCompare(right.filePath) || left.line - right.line || left.column - right.column || left.code.localeCompare(right.code));
  return {
    findings,
    summary: {
      filesScanned: files.size,
      errors: findings.filter(finding => finding.severity === 'error').length,
      warnings: findings.filter(finding => finding.severity === 'warning').length
    }
  };
}

function renderStylish(findings: CliFinding[], summary: ScanSummary): string {
  if (!findings.length) {
    return `Kanmi: no findings in ${summary.filesScanned} file(s).\n`;
  }
  const lines = findings.map(finding =>
    `${finding.filePath}:${finding.line}:${finding.column} ${finding.severity} ${finding.code} ${finding.message} [${finding.classification}]`
  );
  lines.push('');
  lines.push(`${summary.errors} error(s), ${summary.warnings} warning(s) in ${summary.filesScanned} file(s).`);
  return `${lines.join('\n')}\n`;
}

function renderJson(findings: CliFinding[], summary: ScanSummary): string {
  const report: JsonReport = { version: 1, findings, summary };
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function run(
  args: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr
): number {
  let options: CliOptions | 'help';
  try {
    options = parseArgs(args);
  } catch (error) {
    stderr.write(`kanmi: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    return EXIT_CODES.usage;
  }
  if (options === 'help') {
    stdout.write(`${usage()}\n`);
    return EXIT_CODES.clean;
  }

  try {
    const policy = loadPolicy(cwd, options.configPath);
    const result = scan(options, policy, cwd);
    stdout.write(options.format === 'json'
      ? renderJson(result.findings, result.summary)
      : renderStylish(result.findings, result.summary));
    return result.summary.errors > 0
      ? EXIT_CODES.errors
      : result.summary.warnings > 0
        ? EXIT_CODES.warnings
        : EXIT_CODES.clean;
  } catch (error) {
    stderr.write(`kanmi: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_CODES.runtime;
  }
}

if (require.main === module) {
  process.exitCode = run();
}