'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  detectRiskSignals,
  findLibraryRoots,
  scanGames,
  steamExecutable,
  steamWindowsExecutable,
  validateSteamDownloadUrl,
  verifyWindowsExecutable,
  windowsPathToHost,
} = require('../electron/lib/steam.cjs');

test('Windows drive paths map into a Wine prefix', () => {
  const prefix = path.join(path.sep, 'tmp', 'prefix');
  assert.equal(windowsPathToHost('C:\\Games\\Demo', prefix), path.join(prefix, 'drive_c', 'Games', 'Demo'));
  assert.equal(windowsPathToHost('Z:\\Users\\demo', prefix), path.join(path.sep, 'Users', 'demo'));
});

test('scanGames reads Steam app manifests', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-library-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const steamRoot = path.join(root, 'drive_c', 'Program Files (x86)', 'Steam');
  const steamapps = path.join(steamRoot, 'steamapps');
  fs.mkdirSync(steamapps, { recursive: true });
  fs.writeFileSync(path.join(steamRoot, 'steam.exe'), 'MZ');
  fs.writeFileSync(path.join(steamapps, 'appmanifest_10.acf'), `"AppState"
{
  "appid" "10"
  "name" "Counter-Strike"
  "installdir" "Half-Life"
  "StateFlags" "4"
  "SizeOnDisk" "1234"
}`);
  const games = await scanGames(root);
  assert.equal(games.length, 1);
  assert.equal(games[0].name, 'Counter-Strike');
  assert.equal(games[0].fullyInstalled, true);
  assert.equal(games[0].sizeOnDisk, 1234);
  assert.match(steamExecutable(root), /steam\.exe$/);
});

test('library scanning ignores Z drive and symlinked roots outside the bottle', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-library-boundary-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-outside-'));
  context.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const steamRoot = path.join(root, 'drive_c', 'Program Files (x86)', 'Steam');
  fs.mkdirSync(path.join(steamRoot, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(steamRoot, 'steam.exe'), 'MZ');
  fs.mkdirSync(path.join(outside, 'steamapps'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dosdevices'), { recursive: true });
  fs.writeFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), '"libraryfolders" { "0" { "path" "Z:\\\\Users" } "1" { "path" "D:\\\\Games" } }');
  const roots = await findLibraryRoots(root);
  assert.deepEqual(roots, [steamRoot]);
});

test('library scanning rejects an external Steam installation symlink', async (context) => {
  if (process.platform === 'win32') {
    assert.ok(true);
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-steam-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-steam-root-outside-'));
  context.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, 'drive_c', 'Program Files (x86)'), { recursive: true });
  const outsideSteam = path.join(outside, 'Steam');
  fs.mkdirSync(path.join(outsideSteam, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(outsideSteam, 'steam.exe'), 'MZ');
  fs.symlinkSync(outsideSteam, path.join(root, 'drive_c', 'Program Files (x86)', 'Steam'), 'dir');
  assert.deepEqual(await findLibraryRoots(root), []);
});

test('Steam installer URLs only accept the official CDN', () => {
  assert.equal(validateSteamDownloadUrl('https://cdn.akamai.steamstatic.com/client/installer/SteamSetup.exe').hostname, 'cdn.akamai.steamstatic.com');
  assert.throws(() => validateSteamDownloadUrl('https://evil.example/SteamSetup.exe'), /受信任/);
  assert.throws(() => validateSteamDownloadUrl('http://cdn.akamai.steamstatic.com/SteamSetup.exe'), /受信任/);
});

test('risk detection recognizes anti-cheat and driver markers', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-risk-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'EasyAntiCheat'), { recursive: true });
  fs.writeFileSync(path.join(root, 'EasyAntiCheat', 'EasyAntiCheat_EOS_Setup.exe'), '');
  fs.writeFileSync(path.join(root, 'bedaisy.sys'), '');
  const signals = await detectRiskSignals(root);
  assert.deepEqual(signals, ['easy-anticheat', 'kernel-driver']);
});

test('Steam launch rejects an executable symlink outside the Bottle', (context) => {
  if (process.platform === 'win32') {
    assert.ok(true);
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-steam-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-steam-link-outside-'));
  context.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const steamRoot = path.join(root, 'drive_c', 'Program Files (x86)', 'Steam');
  fs.mkdirSync(steamRoot, { recursive: true });
  fs.writeFileSync(path.join(outside, 'steam.exe'), 'MZ');
  fs.symlinkSync(path.join(outside, 'steam.exe'), path.join(steamRoot, 'steam.exe'), 'file');
  assert.throws(() => steamWindowsExecutable(root), /跳出|有效/);
});

test('installer verification rejects symlinked download content', async (context) => {
  if (process.platform === 'win32') {
    assert.ok(true);
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-installer-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-installer-link-outside-'));
  context.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const source = path.join(outside, 'installer.exe');
  const link = path.join(root, 'installer.exe');
  fs.writeFileSync(source, Buffer.alloc(128));
  fs.symlinkSync(source, link, 'file');
  await assert.rejects(() => verifyWindowsExecutable(link), /普通文件/);
});
