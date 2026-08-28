'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { runCommand } = require('./runner.cjs');
const {
  assertPathInside,
  assertBottleSafe,
  buildWineEnvironment,
  prepareBottleRuntimeDirectories,
  validateBottlePath,
  validateEnginePath,
} = require('./security.cjs');

const METADATA_FILE = '.steambridge.json';

function bottleInfo(bottlePath) {
  if (!bottlePath) return { path: '', exists: false, initialized: false, steamInstalled: false, hostFilesProtected: false };
  const driveC = path.join(bottlePath, 'drive_c');
  const steamCandidates = [
    path.join(driveC, 'Program Files (x86)', 'Steam', 'steam.exe'),
    path.join(driveC, 'Program Files', 'Steam', 'steam.exe'),
  ];
  let rootMappingExists = false;
  try { fs.lstatSync(path.join(bottlePath, 'dosdevices', 'z:')); rootMappingExists = true; } catch { /* absent is protected */ }
  return {
    path: bottlePath,
    name: path.basename(bottlePath),
    exists: fs.existsSync(bottlePath),
    initialized: fs.existsSync(driveC),
    steamInstalled: steamCandidates.some((candidate) => fs.existsSync(candidate)),
    hostFilesProtected: !rootMappingExists,
  };
}

async function hardenBottle(bottlePath) {
  const resolved = validateBottlePath(bottlePath);
  prepareBottleRuntimeDirectories(resolved);
  const dosDevices = path.join(resolved, 'dosdevices');
  const rootMapping = path.join(dosDevices, 'z:');
  assertPathInside(resolved, dosDevices, { label: 'Bottle dosdevices 目录', rejectSymlinks: true });
  await fsp.chmod(resolved, 0o700);
  try {
    const stat = await fsp.lstat(rootMapping);
    if (!stat.isSymbolicLink()) throw new Error('安全停止：Bottle 的 Z: 映射不是符号链接。');
    const linkTarget = await fsp.readlink(rootMapping);
    const resolvedTarget = path.resolve(path.dirname(rootMapping), linkTarget);
    let realTarget;
    try { realTarget = await fsp.realpath(resolvedTarget); } catch { realTarget = resolvedTarget; }
    const root = path.parse(realTarget).root;
    if (realTarget === root || !isPathInside(resolved, realTarget)) {
      throw new Error('安全停止：Bottle 的 Z: 映射指向主机或 Bottle 外部。');
    }
    await fsp.unlink(rootMapping);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  assertBottleSafe(resolved);
  return bottleInfo(resolved);
}

function safeBottleName(value) {
  const name = String(value ?? '').trim();
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name)) {
    throw new Error('Bottle 名称不能为空，且不能包含路径或特殊字符。');
  }
  return name.slice(0, 64);
}

function isPathInside(basePath, targetPath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function winebootForEngine(enginePath) {
  const directory = path.dirname(enginePath);
  const candidates = process.platform === 'win32'
    ? [path.join(directory, 'wineboot.exe'), path.join(directory, 'wineboot')]
    : [path.join(directory, 'wineboot'), path.join(directory, 'wineboot64')];
  const found = candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!found) throw new Error(`引擎目录中缺少 wineboot：${directory}`);
  return found;
}

async function createBottle({ bottlePath, enginePath, onLine, guard }) {
  enginePath = validateEnginePath(enginePath);
  if (!enginePath) throw new Error('请先选择可用的 Wine 兼容引擎。');
  if (!bottlePath) throw new Error('Bottle 路径不能为空。');
  await fsp.mkdir(bottlePath, { recursive: true, mode: 0o700 });
  bottlePath = assertPathInside(path.dirname(path.resolve(bottlePath)), bottlePath, {
    label: 'Bottle 路径',
    rejectSymlinks: true,
  });
  prepareBottleRuntimeDirectories(bottlePath);
  const dosDevices = path.join(bottlePath, 'dosdevices');
  await fsp.mkdir(path.join(bottlePath, 'drive_c'), { recursive: true, mode: 0o700 });
  await fsp.mkdir(dosDevices, { recursive: true, mode: 0o700 });
  assertPathInside(bottlePath, dosDevices, { label: 'Bottle dosdevices 目录', rejectSymlinks: true });
  if (process.platform !== 'win32') {
    for (const [name, target] of [['c:', '../drive_c'], ['z:', '../drive_c']]) {
      const mapping = path.join(dosDevices, name);
      try { await fsp.lstat(mapping); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fsp.symlink(target, mapping);
      }
    }
  }
  await fsp.writeFile(path.join(bottlePath, METADATA_FILE), JSON.stringify({
    schema: 1,
    createdAt: new Date().toISOString(),
    enginePath,
  }, null, 2), { mode: 0o600 });
  await runCommand(winebootForEngine(enginePath), ['-u'], {
    env: buildWineEnvironment(bottlePath),
    inheritEnv: false,
    onLine,
    guard: guard ?? (() => assertBottleSafe(bottlePath, { allowInternalZ: true })),
    timeout: 120_000,
  });
  return hardenBottle(bottlePath);
}

async function listBottles(rootPath) {
  let entries = [];
  try {
    entries = await fsp.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => bottleInfo(path.join(rootPath, entry.name)))
    .filter((entry) => entry.initialized || fs.existsSync(path.join(entry.path, METADATA_FILE)))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

module.exports = {
  METADATA_FILE,
  bottleInfo,
  createBottle,
  hardenBottle,
  listBottles,
  safeBottleName,
  winebootForEngine,
};
