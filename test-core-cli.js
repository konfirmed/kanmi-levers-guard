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

test('source guard reports missing image alt and dimensions', () => {
  const findings = scanSourceGuard('<img src="/hero.jpg">');
  assert.ok(codes(findings).includes('SEO_IMG_ALT_MISSING'));
  assert.ok(codes(findings).includes('PERF_IMG_DIMENSIONS_MISSING'));
});

test('source guard does not flag an img with alt and dimensions', () => {
  const findings = scanSourceGuard('<img src="/hero.jpg" alt="Hero" width="1200" height="630">');
  assert.ok(!codes(findings).includes('SEO_IMG_ALT_MISSING'));
  assert.ok(!codes(findings).includes('PERF_IMG_DIMENSIONS_MISSING'));
});

test('source guard reports blocking scripts but accepts module scripts', () => {
  const blocking = scanSourceGuard('<script src="/app.js"></script>');
  const moduleScript = scanSourceGuard('<script type="module" src="/app.js"></script>');
  assert.ok(codes(blocking).includes('PERF_SCRIPT_BLOCKING'));
  assert.ok(!codes(moduleScript).includes('PERF_SCRIPT_BLOCKING'));
});

test('source guard enforces configured third-party script budget', () => {
  const findings = scanSourceGuard(
    '<script src="https://a.test/a.js" defer></script><script src="https://b.test/b.js" defer></script>',
    { perf: { maxThirdPartyScriptsPerPage: 1 } }
  );
  assert.ok(codes(findings).includes('PERF_SCRIPT_COUNT_POLICY'));
});

test('production HTML receives the same universal rules as source scans', () => {
  const findings = scanProductionGuard(
    '/tmp/kanmi-artifacts/index.html',
    Buffer.from('<img src="/hero.jpg"><script src="/app.js"></script>'),
    { artifactRoot: '/tmp/kanmi-artifacts', nearLimitBytes: 1_500_000 }
  );
  const findingCodes = codes(findings);
  assert.ok(findingCodes.includes('SEO_IMG_ALT_MISSING'));
  assert.ok(findingCodes.includes('PERF_IMG_DIMENSIONS_MISSING'));
  assert.ok(findingCodes.includes('PERF_SCRIPT_BLOCKING'));
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

test('guard fails on errors by default but not warnings or info', () => {
  const info = [{ code: 'i', severity: 'info', message: 'i', offset: 0 }];
  const warning = [{ code: 'x', severity: 'warning', message: 'x', offset: 0 }];
  const error = [{ code: 'x', severity: 'error', message: 'x', classification: 'kanmi-heuristic', evidence: {} }];

  assert.equal(shouldFailGuard(info), false);
  assert.equal(shouldFailGuard(info, 'warning'), false);
  assert.equal(shouldFailGuard(warning), false);
  assert.equal(shouldFailGuard(warning, 'warning'), true);
  assert.equal(shouldFailGuard(error), true);
});
