const assert = require('node:assert/strict');
const test = require('node:test');
const {
  filterDisabledFindings,
  scanProductionArtifact,
  scanSourceSize,
  scanWrsBehaviorRules,
  shouldScanProductionArtifactPath
} = require('./out/wrs.js');

const options = {
  nearLimitBytes: 1_500_000,
  artifactRoot: '/tmp/kanmi-artifacts',
  robotsText: 'User-agent: *\nDisallow: /assets/\n'
};

function codes(findings) {
  return findings.map(finding => finding.code);
}

test('accepts HTML below the Kanmi warning threshold', () => {
  const findings = scanProductionArtifact(
    '/tmp/kanmi-artifacts/index.html',
    Buffer.alloc(1_499_999),
    options
  );

  assert.deepEqual(codes(findings), []);
});

test('reports a production artifact near the 2 MB ceiling without treating it as a hard failure', () => {
  const findings = scanProductionArtifact(
    '/tmp/kanmi-artifacts/index.html',
    Buffer.alloc(1_500_001),
    options
  );

  assert.deepEqual(codes(findings), ['wrs/resource-near-limit']);
});

test('applies a configured byte safety threshold', () => {
  const findings = scanProductionArtifact(
    '/tmp/kanmi-artifacts/index.html',
    Buffer.alloc(1_600_001),
    { ...options, nearLimitBytes: 1_700_000 }
  );

  assert.deepEqual(codes(findings), []);
});

test('reports the exact 2,000,000-byte artifact boundary as an error', () => {
  const findings = scanProductionArtifact(
    '/tmp/kanmi-artifacts/app.js',
    Buffer.alloc(2_000_000),
    options
  );

  assert.deepEqual(codes(findings), ['wrs/resource-over-2mb']);
});

test('reports HTML critical content that starts before the cutoff without a cutoff error', () => {
  const content = Buffer.concat([
    Buffer.alloc(1_999_700, 32),
    Buffer.from('<title>Early</title><meta name="description" content="Early"><link rel="canonical" href="/"><meta name="robots" content="index"><script type="application/ld+json">{}</script><main>Content</main><script src="/app.12345678.js"></script><link rel="stylesheet" href="/app.12345678.css">')
  ]);
  const findings = scanProductionArtifact('/tmp/kanmi-artifacts/index.html', content, options);

  assert.ok(!codes(findings).includes('wrs/critical-content-after-cutoff'));
});

test('reports critical HTML content after the Googlebot cutoff', () => {
  const content = Buffer.concat([
    Buffer.alloc(2_000_001, 32),
    Buffer.from('<title>Late title</title><meta name="description" content="Late"><link rel="canonical" href="/"><meta name="robots" content="index"><script type="application/ld+json">{}</script><main>Content</main><script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">')
  ]);
  const findings = scanProductionArtifact('/tmp/kanmi-artifacts/index.html', content, options);
  const findingCodes = codes(findings);

  assert.ok(findingCodes.includes('wrs/resource-over-2mb'));
  assert.ok(findingCodes.includes('wrs/critical-content-after-cutoff'));
  assert.ok(findingCodes.includes('wrs/unfingerprinted-assets'));
  assert.ok(findingCodes.includes('wrs/blocked-critical-resource'));
});

test('keeps PDF handling separate from WRS resource checks', () => {
  const findings = scanProductionArtifact(
    '/tmp/kanmi-artifacts/document.pdf',
    Buffer.alloc(64_000_000),
    options
  );

  assert.deepEqual(codes(findings), ['PERF_PDF_SIZE_EXCEEDED']);
});

test('does not report a PDF below the separate 64 MB threshold', () => {
  const findings = scanProductionArtifact(
    '/tmp/kanmi-artifacts/document.pdf',
    Buffer.alloc(64_000_000 - 1),
    options
  );

  assert.deepEqual(codes(findings), []);
});

test('evaluates JavaScript, CSS, and JSON independently at 2 MB', () => {
  for (const extension of ['js', 'css', 'json']) {
    const findings = scanProductionArtifact(
      `/tmp/kanmi-artifacts/resource.${extension}`,
      Buffer.alloc(2_000_001),
      options
    );
    assert.ok(codes(findings).includes('wrs/resource-over-2mb'));
  }
});

test('reports interaction-dependent content', () => {
  assert.ok(codes(scanWrsBehaviorRules('<button onClick={() => setContent(true)}>Load</button>')).includes('wrs/interaction-dependent-content'));
});

test('reports persisted-state dependency', () => {
  assert.ok(codes(scanWrsBehaviorRules('localStorage.getItem("session");')).includes('wrs/persisted-state-dependency'));
});

test('reports WebSocket and WebRTC content transport', () => {
  assert.ok(codes(scanWrsBehaviorRules('new WebSocket("wss://example.test");')).includes('wrs/unsupported-content-transport'));
  assert.ok(codes(scanWrsBehaviorRules('new RTCPeerConnection();')).includes('wrs/unsupported-content-transport'));
});

test('reports permission-gated content', () => {
  assert.ok(codes(scanWrsBehaviorRules('navigator.geolocation.getCurrentPosition(loadContent);')).includes('wrs/permission-gated-content'));
});

test('reports WebGL-only meaningful content', () => {
  assert.ok(codes(scanWrsBehaviorRules('canvas.getContext("webgl");')).includes('wrs/webgl-only-content'));
});

test('reports JavaScript-dependent non-200 handling', () => {
  assert.ok(codes(scanWrsBehaviorRules('return { status: 404 }; useEffect(() => fetch("/api/content"));')).includes('wrs/non-200-render-dependency'));
});

test('reports frozen Googlebot or Chromium version assumptions', () => {
  assert.ok(codes(scanWrsBehaviorRules('const userAgent = navigator.userAgent; userAgent.includes("Chrome/120");')).includes('wrs/user-agent-version-assumption'));
});

test('exposes classification and evidence for WRS findings', () => {
  const findings = scanProductionArtifact(
    '/tmp/kanmi-artifacts/app.js',
    Buffer.alloc(2_000_001),
    options
  );

  assert.equal(findings[0].classification, 'static-approximation');
  assert.equal(findings[0].evidence.ruleId, 'wrs/resource-over-2mb');
});

test('applies disabled rules consistently to WRS findings', () => {
  const findings = scanWrsBehaviorRules('new WebSocket("wss://example.test"); canvas.getContext("webgl");');
  const filtered = filterDisabledFindings(findings, ['wrs/webgl-only-content']);

  assert.ok(codes(filtered).includes('wrs/unsupported-content-transport'));
  assert.ok(!codes(filtered).includes('wrs/webgl-only-content'));
});

test('excludes dependency, VCS, and irrelevant paths from artifact candidates', () => {
  assert.equal(shouldScanProductionArtifactPath('/tmp/dist/index.html'), true);
  assert.equal(shouldScanProductionArtifactPath('/tmp/dist/node_modules/pkg/app.js'), false);
  assert.equal(shouldScanProductionArtifactPath('/tmp/dist/.git/config'), false);
  assert.equal(shouldScanProductionArtifactPath('/tmp/dist/readme.txt'), false);
  assert.equal(shouldScanProductionArtifactPath('/tmp/dist/source.ts'), false);
});

test('labels source bytes as an estimate', () => {
  const findings = scanSourceSize(1_500_001, 1_500_000);

  assert.equal(findings[0].code, 'wrs/source-size-estimate');
  assert.match(findings[0].message, /Static source estimate/);
  assert.doesNotMatch(findings[0].message, /Google WRS (hard )?limit|Google WRS recommends/);
});