export type FindingSeverity = 'error' | 'warning' | 'info';

export type FindingClassification =
  | 'documented-platform-behaviour'
  | 'measured-production-fact'
  | 'static-approximation'
  | 'kanmi-heuristic';

export interface Finding {
  code: string;
  severity: FindingSeverity;
  message: string;
  classification: FindingClassification;
  evidence: Record<string, unknown>;
  offset?: number;
}