'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assertPathInside,
  assertBottleSafe,
  buildWineEnvironment,
  prepareBottleRuntimeDirectories,
  validateBottlePath,
  validateSettingsPatch,
} = require('../electron/lib/security.cjs');
const { AppLogger, MAX_MESSAGE_LENGTH, redactLogMessage } = require('../electron/lib/logger.cjs');

test('Wine environment isolates home, temp and inherited credentials', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-env-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  prepareBottleRuntimeDirectories(root);
  const environment = buildWineEnvironment(root);
  assert.equal(environment.WINEPREFIX, root);
  assert.equal(environment.HOME, path.join(root, '.steambridge-home'));
  assert.equal(environment.TMPDIR, path.join(root, '.steambridge-tmp'));
  assert.equal(Object.hasOwn(environment, 'AWS_SECRET_ACCESS_KEY'), false);
});

test('runtime directories reject symlink escape', (context) => {
  if (process.platform === 'win32') {
    assert.ok(true);
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-runtime-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-runtime-outside-'));
  context.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.symlinkSync(outside, path.join(root, '.steambridge-tmp'), 'dir');
  assert.throws(() => prepareBottleRuntimeDirectories(root), /符号链接/);
  assert.equal(fs.readdirSync(outside).length, 0);
  assert.equal(assertPathInside(root, root), fs.realpathSync(root));
});

test('Bottle safety guard rejects host mappings and broad permissions', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-guard-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'drive_c'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dosdevices'), { recursive: true });
  prepareBottleRuntimeDirectories(root);
  assert.equal(assertBottleSafe(root), fs.realpathSync(root));
  if (process.platform !== 'win32') {
    fs.symlinkSync('../drive_c', path.join(root, 'dosdevices', 'z:'));
    assert.equal(assertBottleSafe(root, { allowInternalZ: true }), fs.realpathSync(root));
    fs.unlinkSync(path.join(root, 'dosdevices', 'z:'));
    fs.symlinkSync('/', path.join(root, 'dosdevices', 'z:'));
    assert.throws(() => assertBottleSafe(root), /安全停止.*Z/);
    fs.unlinkSync(path.join(root, 'dosdevices', 'z:'));
    fs.chmodSync(path.join(root, '.steambridge-home'), 0o755);
    assert.throws(() => assertBottleSafe(root), /运行时目录对其他用户开放/);
    fs.chmodSync(path.join(root, '.steambridge-home'), 0o700);
    fs.chmodSync(root, 0o755);
    assert.throws(() => assertBottleSafe(root), /对其他用户开放/);
  }
});

test('settings reject non-boolean flags and unsafe Bottle paths', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-security-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'drive_c'));
  assert.deepEqual(validateSettingsPatch({ bottlePath: root, showUninstalled: true }), { bottlePath: root, showUninstalled: true });
  assert.throws(() => validateSettingsPatch({ showUninstalled: 'true' }), /布尔值/);
  assert.throws(() => validateBottlePath(os.homedir()), /用户主目录/);
});

test('logs redact secrets and cap messages', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-logs-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.match(redactLogMessage('Bearer abc123 password: secret', '/Users/alice'), /REDACTED/);
  const logger = new AppLogger(path.join(root, 'steambridge.log'));
  logger.info('test', 'x'.repeat(MAX_MESSAGE_LENGTH + 100));
  assert.equal(logger.read(1)[0].message.length, MAX_MESSAGE_LENGTH);
});

test('logger refuses a symlinked log file', (context) => {
  if (process.platform === 'win32') {
    assert.ok(true);
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-log-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-log-link-outside-'));
  context.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const outsideLog = path.join(outside, 'outside.log');
  fs.writeFileSync(outsideLog, 'keep');
  fs.symlinkSync(outsideLog, path.join(root, 'steambridge.log'), 'file');
  assert.throws(() => new AppLogger(path.join(root, 'steambridge.log')), /不安全/);
  assert.equal(fs.readFileSync(outsideLog, 'utf8'), 'keep');
});
