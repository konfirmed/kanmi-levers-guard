const assert = require('node:assert/strict');
const test = require('node:test');
const {
  resolveWrsNearLimitBytes,
  scanProductionGuard,
  scanSourceGuard,
  shouldFailGuard
} = require('./out/core.js');

function codes(findings) {
  return findings.map(finding => finding.code);
}

test('source guard reuses WRS behavior rules outside VS Code', () => {
  const findings = scanSourceGuard('<button onClick={() => setContent(true)}>Load</button>');
  assert.ok(codes(findings).includes('wrs/interaction-dependent-content'));
});

test('source guard respects disabled rules', () => {
  const findings = scanSourceGuard(
    '<button onClick={() => setContent(true)}>Load</button>',
    { disabledRules: ['wrs/interaction-dependent-content'] }
  );
  assert.deepEqual(findings, []);
});

test('production guard applies configured near-limit threshold', () => {
  const findings = scanProductionGuard(
    '/tmp/kanmi-artifacts/app.js',
    Buffer.alloc(1_600_000),
    { artifactRoot: '/tmp/kanmi-artifacts', nearLimitBytes: 1_500_000 }
  );
  assert.ok(codes(findings).includes('wrs/resource-near-limit'));
});

test('near-limit policy is clamped below hard WRS ceiling', () => {
  assert.equal(resolveWrsNearLimitBytes({ wrs: { resourceNearLimitBytes: 9_000_000 } }), 1_999_999);
});

test('guard fails on errors by default but not warnings', () => {
  const warning = [{ code: 'x', severity: 'warning', message: 'x', classification: 'kanmi-heuristic', evidence: {} }];
  const error = [{ code: 'x', severity: 'error', message: 'x', classification: 'kanmi-heuristic', evidence: {} }];

  assert.equal(shouldFailGuard(warning), false);
  assert.equal(shouldFailGuard(warning, 'warning'), true);
  assert.equal(shouldFailGuard(error), true);
});
