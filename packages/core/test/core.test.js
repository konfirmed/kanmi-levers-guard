const assert = require('node:assert/strict');
const test = require('node:test');
const { filterDisabledFindings, normalizePolicy } = require('../dist');

test('normalizes a policy document without accepting non-string rule IDs', () => {
  assert.deepEqual(normalizePolicy({
    wrs: { resourceNearLimitBytes: 1200000 },
    disabledRules: ['wrs/resource-near-limit', 42]
  }), {
    wrs: { resourceNearLimitBytes: 1200000 },
    disabledRules: ['wrs/resource-near-limit']
  });
});

test('filters canonical and legacy disabled rule IDs', () => {
  const findings = [
    { code: 'PERF_DOM_SIZE_HEURISTIC', severity: 'warning', message: '', classification: 'kanmi-heuristic', evidence: {} },
    { code: 'wrs/resource-near-limit', severity: 'warning', message: '', classification: 'static-approximation', evidence: {} }
  ];

  assert.deepEqual(filterDisabledFindings(findings, ['WRS_DOM_SIZE_WARNING']), [findings[1]]);
});