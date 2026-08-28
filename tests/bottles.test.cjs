'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bottleInfo, hardenBottle, listBottles, safeBottleName, winebootForEngine } = require('../electron/lib/bottles.cjs');

test('safeBottleName accepts labels but rejects path traversal', () => {
  assert.equal(safeBottleName('Steam Main'), 'Steam Main');
  assert.throws(() => safeBottleName('../escape'), /特殊字符/);
  assert.throws(() => safeBottleName(''), /不能为空/);
});

test('listBottles finds initialized prefixes', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-bottles-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prefix = path.join(root, 'Steam');
  fs.mkdirSync(path.join(prefix, 'drive_c'), { recursive: true });
  assert.equal(bottleInfo(prefix).initialized, true);
  const entries = await listBottles(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Steam');
});

test('winebootForEngine resolves the helper beside Wine', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-engine-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engine = path.join(root, process.platform === 'win32' ? 'wine.exe' : 'wine');
  const wineboot = path.join(root, process.platform === 'win32' ? 'wineboot.exe' : 'wineboot');
  fs.writeFileSync(engine, '');
  fs.writeFileSync(wineboot, '');
  fs.chmodSync(wineboot, 0o755);
  assert.equal(winebootForEngine(engine), wineboot);
});

test('bottleInfo detects a Z drive entry as unprotected', (context) => {
  if (process.platform === 'win32') {
    // Windows reserves ':' in filenames, so Wine's Unix-style dosdevices
    // mapping cannot be represented by this filesystem test.
    assert.ok(true);
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-z-drive-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'drive_c'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dosdevices'), { recursive: true });
  fs.symlinkSync(path.join(root, 'missing-host-root'), path.join(root, 'dosdevices', 'z:'));
  assert.equal(bottleInfo(root).hostFilesProtected, false);
});

test('hardenBottle rejects a symlinked dosdevices directory', async (context) => {
  if (process.platform === 'win32') {
    assert.ok(true);
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-dosdevices-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-dosdevices-outside-'));
  context.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, 'drive_c'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'dosdevices'), 'dir');
  await assert.rejects(() => hardenBottle(root), /符号链接/);
});

test('hardenBottle refuses a Z mapping to the host root', async (context) => {
  if (process.platform === 'win32') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-host-z-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'drive_c'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dosdevices'), { recursive: true });
  fs.symlinkSync('/', path.join(root, 'dosdevices', 'z:'));
  await assert.rejects(() => hardenBottle(root), /安全停止.*Bottle 的 Z/);
  assert.equal(fs.existsSync(path.join(root, 'dosdevices', 'z:')), true);
});
