const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const cliPath = path.join(__dirname, '..', 'dist', 'index.js');

function withFixture(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kanmi-cli-'));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('returns JSON errors for an artifact over the WRS ceiling', () => {
  withFixture(directory => {
    fs.writeFileSync(path.join(directory, 'index.html'), Buffer.alloc(2_000_000, 'x'));
    const result = spawnSync(process.execPath, [cliPath, 'scan', directory, '--format', 'json'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.errors, 1);
    assert.equal(report.findings[0].code, 'wrs/resource-over-2mb');
    assert.match(report.findings[0].filePath, /index\.html$/);
  });
});

test('returns stylish warnings and supports rule suppression', () => {
  withFixture(directory => {
    fs.writeFileSync(path.join(directory, 'index.html'), Buffer.alloc(1_600_000, 'x'));
    const warning = spawnSync(process.execPath, [cliPath, 'scan', directory], { encoding: 'utf8' });
    assert.equal(warning.status, 1);
    assert.match(warning.stdout, /wrs\/resource-near-limit/);
    assert.match(warning.stdout, /static-approximation/);

    const suppressed = spawnSync(process.execPath, [cliPath, 'scan', directory, '--disable-rule', 'wrs/resource-near-limit', '--format=json'], { encoding: 'utf8' });
    assert.equal(suppressed.status, 0);
    assert.deepEqual(JSON.parse(suppressed.stdout).findings, []);
  });
});

test('reports usage errors without scanning', () => {
  const result = spawnSync(process.execPath, [cliPath, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /the scan command is required/);
});