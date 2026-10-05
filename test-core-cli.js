const assert = require('node:assert/strict');
const test = require('node:test');
const {
  resolveWrsNearLimitBytes,
  scanProductionGuard,
  scanSourceGuard,
  shouldFailGuard
} = require('./out/core.js');
const { detectSourceContext } = require('./out/context.js');

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

test('detects Next.js App Router context from path', () => {
  const context = detectSourceContext('/repo/app/products/page.tsx', 'export default function Page(){ return <main /> }');
  assert.equal(context.framework, 'next-app');
  assert.equal(context.isNextJs, true);
});

test('detects Next.js Pages Router context from path', () => {
  const context = detectSourceContext('/repo/pages/index.tsx', 'export default function Home(){ return <main /> }');
  assert.equal(context.framework, 'next-pages');
  assert.equal(context.isNextJs, true);
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

test('JSX img with spread props is not treated as definitely missing attributes', () => {
  const findings = scanSourceGuard(
    '<img {...imageProps} src="/hero.jpg" />',
    {},
    { filePath: '/repo/app/page.tsx' }
  );
  assert.ok(!codes(findings).includes('SEO_IMG_ALT_MISSING'));
  assert.ok(!codes(findings).includes('PERF_IMG_DIMENSIONS_MISSING'));
});

test('source guard reports blocking scripts but accepts module scripts for HTML-like source', () => {
  const blocking = scanSourceGuard('<script src="/app.js"></script>', {}, { filePath: '/repo/index.html' });
  const moduleScript = scanSourceGuard('<script type="module" src="/app.js"></script>', {}, { filePath: '/repo/index.html' });
  assert.ok(codes(blocking).includes('PERF_SCRIPT_BLOCKING'));
  assert.ok(!codes(moduleScript).includes('PERF_SCRIPT_BLOCKING'));
});

test('Next.js App Router source does not get raw HTML script blocking noise', () => {
  const findings = scanSourceGuard(
    'export default function Page(){ return <script src="https://example.com/app.js"></script> }',
    { perf: { maxThirdPartyScriptsPerPage: 0 } },
    { filePath: '/repo/app/page.tsx' }
  );
  assert.ok(!codes(findings).includes('PERF_SCRIPT_BLOCKING'));
  assert.ok(!codes(findings).includes('PERF_SCRIPT_COUNT_POLICY'));
});

test('Next.js Pages Router source does not get raw HTML script blocking noise', () => {
  const findings = scanSourceGuard(
    'export default function Home(){ return <script src="https://example.com/app.js"></script> }',
    { perf: { maxThirdPartyScriptsPerPage: 0 } },
    { filePath: '/repo/pages/index.tsx' }
  );
  assert.ok(!codes(findings).includes('PERF_SCRIPT_BLOCKING'));
  assert.ok(!codes(findings).includes('PERF_SCRIPT_COUNT_POLICY'));
});

test('source guard enforces configured third-party script budget for HTML source', () => {
  const findings = scanSourceGuard(
    '<script src="https://a.test/a.js" defer></script><script src="https://b.test/b.js" defer></script>',
    { perf: { maxThirdPartyScriptsPerPage: 1 } },
    { filePath: '/repo/index.html' }
  );
  assert.ok(codes(findings).includes('PERF_SCRIPT_COUNT_POLICY'));
});

test('production HTML still receives raw HTML universal rules', () => {
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
