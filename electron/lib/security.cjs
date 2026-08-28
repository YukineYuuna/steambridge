'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHILD_ENV_ALLOWLIST = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL',
  'DISPLAY', 'XAUTHORITY', '__CF_USER_TEXT_ENCODING',
  'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH',
  'VK_ICD_FILENAMES', 'GST_PLUGIN_PATH', 'GST_PLUGIN_SYSTEM_PATH',
  'CX_ROOT', 'WINEDLLPATH', 'WINELOADER', 'WINESERVER',
]);

function buildSafeChildEnvironment(extra = {}) {
  const environment = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

function buildWineEnvironment(bottlePath, extra = {}) {
  const isolatedHome = path.join(bottlePath, '.steambridge-home');
  const isolatedTmp = path.join(bottlePath, '.steambridge-tmp');
  return {
    ...buildSafeChildEnvironment(),
    HOME: isolatedHome,
    TMPDIR: isolatedTmp,
    XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
    XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),
    XDG_DATA_HOME: path.join(isolatedHome, '.local', 'share'),
    WINEPREFIX: bottlePath,
    WINEDEBUG: '-all',
    WINEDLLOVERRIDES: 'winemenubuilder.exe=d',
    ...extra,
  };
}

function prepareBottleRuntimeDirectories(bottlePath) {
  const resolvedBottle = assertPathInside(bottlePath, bottlePath, { label: 'Bottle' });
  const directories = [
    path.join(resolvedBottle, '.steambridge-home', '.config'),
    path.join(resolvedBottle, '.steambridge-home', '.cache'),
    path.join(resolvedBottle, '.steambridge-home', '.local', 'share'),
    path.join(resolvedBottle, '.steambridge-tmp'),
  ];
  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertPathInside(resolvedBottle, directory, { label: 'Bottle 运行时目录', rejectSymlinks: true });
    try { fs.chmodSync(directory, 0o700); } catch { /* best effort on filesystems without POSIX modes */ }
  }
}

function assertBottleSafe(bottlePath, { allowInternalZ = false } = {}) {
  const resolvedBottle = validateBottlePath(bottlePath);
  const dosDevices = path.join(resolvedBottle, 'dosdevices');
  assertPathInside(resolvedBottle, dosDevices, { label: 'Bottle dosdevices 目录', rejectSymlinks: true, allowMissing: false });
  assertPathInside(resolvedBottle, path.join(resolvedBottle, 'drive_c'), { label: 'Bottle C: 盘', rejectSymlinks: true, allowMissing: false });
  const isolatedHome = path.join(resolvedBottle, '.steambridge-home');
  const runtimeDirectories = [
    isolatedHome,
    path.join(isolatedHome, '.config'),
    path.join(isolatedHome, '.cache'),
    path.join(isolatedHome, '.local'),
    path.join(isolatedHome, '.local', 'share'),
    path.join(resolvedBottle, '.steambridge-tmp'),
  ];
  for (const directory of runtimeDirectories) {
    const safeDirectory = assertPathInside(resolvedBottle, directory, { label: 'Bottle 运行时目录', rejectSymlinks: true, allowMissing: false });
    if (process.platform !== 'win32') {
      const mode = fs.statSync(safeDirectory).mode & 0o777;
      if ((mode & 0o077) !== 0) throw new Error('安全停止：Bottle 运行时目录对其他用户开放。');
    }
  }
  const rootMapping = path.join(dosDevices, 'z:');
  let rootMappingStat = null;
  try {
    rootMappingStat = fs.lstatSync(rootMapping);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (rootMappingStat) {
    if (!rootMappingStat.isSymbolicLink() || !allowInternalZ) throw new Error('安全停止：检测到 Bottle 的 Z: 主机根目录映射。');
    const linkTarget = fs.readlinkSync(rootMapping);
    const resolvedTarget = path.resolve(path.dirname(rootMapping), linkTarget);
    const realTarget = fs.realpathSync(resolvedTarget);
    const driveC = fs.realpathSync(path.join(resolvedBottle, 'drive_c'));
    if (!isPathInside(driveC, realTarget)) throw new Error('安全停止：Bottle 的 Z: 映射指向主机或 Bottle 外部。');
  }
  if (process.platform !== 'win32') {
    const mode = fs.statSync(resolvedBottle).mode & 0o777;
    if ((mode & 0o077) !== 0) throw new Error('安全停止：Steam 空间对其他用户开放。');
  }
  return resolvedBottle;
}

function isPathInside(basePath, targetPath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertPathInside(basePath, targetPath, { label = '路径', allowMissing = true, rejectSymlinks = false } = {}) {
  let baseReal;
  try {
    baseReal = fs.realpathSync(path.resolve(basePath));
  } catch {
    throw new Error(`${label}基准目录不存在。`);
  }
  const targetResolved = path.resolve(targetPath);
  if (!isPathInside(baseReal, targetResolved)) throw new Error(`${label}不在允许目录内。`);

  const relative = path.relative(baseReal, targetResolved);
  let current = baseReal;
  const segments = relative.split(path.sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) break;
      throw new Error(`${label}无法安全解析。`);
    }
    if (stat.isSymbolicLink()) {
      if (rejectSymlinks) throw new Error(`${label}不能包含符号链接。`);
      let realCurrent;
      try { realCurrent = fs.realpathSync(current); } catch { throw new Error(`${label}无法安全解析。`); }
      if (!isPathInside(baseReal, realCurrent)) throw new Error(`${label}不能跳出允许目录。`);
      current = realCurrent;
    } else if (!stat.isDirectory() && index < segments.length - 1) {
      throw new Error(`${label}包含非目录路径组件。`);
    }
  }

  try {
    const realTarget = fs.realpathSync(targetResolved);
    if (!isPathInside(baseReal, realTarget)) throw new Error(`${label}不能跳出允许目录。`);
    if (rejectSymlinks && realTarget !== targetResolved) throw new Error(`${label}不能包含符号链接。`);
    return realTarget;
  } catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return targetResolved;
    if (error.message?.includes(`${label}`)) throw error;
    throw new Error(`${label}无法安全解析。`);
  }
}

function validateAbsolutePath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) {
    throw new Error(`${label}路径无效。`);
  }
  if (!path.isAbsolute(value)) throw new Error(`${label}必须使用绝对路径。`);
  return path.resolve(value);
}

function validateEnginePath(value) {
  if (value === '') return '';
  const resolved = validateAbsolutePath(value, '引擎');
  let stat;
  try {
    const realPath = fs.realpathSync(resolved);
    stat = fs.statSync(realPath);
    fs.accessSync(realPath, fs.constants.X_OK);
    if (!stat.isFile()) throw new Error('not-a-file');
    return realPath;
  } catch {
    throw new Error('所选 Wine 引擎不存在或不可执行。');
  }
}

function validateBottlePath(value, { requireInitialized = true } = {}) {
  if (value === '') return '';
  const resolved = validateAbsolutePath(value, 'Bottle');
  let realPath;
  try { realPath = fs.realpathSync(resolved); } catch { throw new Error('所选 Bottle 目录不存在。'); }
  const root = path.parse(realPath).root;
  const home = path.resolve(os.homedir());
  if (realPath === root || realPath === home) throw new Error('不能把磁盘根目录或用户主目录用作 Bottle。');
  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch {
    throw new Error('所选 Bottle 目录不存在。');
  }
  if (!stat.isDirectory()) throw new Error('所选 Bottle 路径不是目录。');
  if (requireInitialized && !fs.existsSync(path.join(realPath, 'drive_c'))) {
    throw new Error('所选目录不是已初始化的 Wine Bottle。');
  }
  return realPath;
}

function resolveExistingPath(value) {
  const resolved = validateAbsolutePath(value, '目标');
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}

function validateSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置内容无效。');
  const allowed = new Set(['enginePath', 'bottlePath', 'showUninstalled']);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new Error(`不支持的设置项：${key}`);
  }
  const validated = {};
  if (Object.hasOwn(patch, 'enginePath')) validated.enginePath = validateEnginePath(patch.enginePath);
  if (Object.hasOwn(patch, 'bottlePath')) validated.bottlePath = validateBottlePath(patch.bottlePath);
  if (Object.hasOwn(patch, 'showUninstalled')) {
    if (typeof patch.showUninstalled !== 'boolean') throw new Error('显示选项必须是布尔值。');
    validated.showUninstalled = patch.showUninstalled;
  }
  return validated;
}

function isTrustedDevelopmentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '5173';
  } catch {
    return false;
  }
}

module.exports = {
  assertPathInside,
  assertBottleSafe,
  buildSafeChildEnvironment,
  buildWineEnvironment,
  isTrustedDevelopmentUrl,
  prepareBottleRuntimeDirectories,
  resolveExistingPath,
  validateBottlePath,
  validateEnginePath,
  validateSettingsPatch,
};
