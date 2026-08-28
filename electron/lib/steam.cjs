'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const https = require('node:https');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { parseVdf } = require('./vdf.cjs');
const { compatibilityFor } = require('./compatibility.cjs');

const STEAM_DOWNLOAD_URL = 'https://cdn.akamai.steamstatic.com/client/installer/SteamSetup.exe';
const STEAM_INSTALLER_SIZE = 2_380_800;
const STEAM_INSTALLER_SHA256 = '7d3654531c32d941b8cae81c4137fc542172bfa9635f169cb392f245a0a12bcb';
const MAX_INSTALLER_SIZE = 16 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 1 * 1024 * 1024;

function validateSteamDownloadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.akamai.steamstatic.com' || url.username || url.password) {
    throw new Error('Steam 安装器下载地址不在受信任的官方域名中。');
  }
  return url;
}

function steamRootForBottle(bottlePath) {
  const candidates = [
    path.join(bottlePath, 'drive_c/Program Files (x86)/Steam'),
    path.join(bottlePath, 'drive_c/Program Files/Steam'),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'steam.exe'))) ?? candidates[0];
}

function steamExecutable(bottlePath) {
  return path.join(steamRootForBottle(bottlePath), 'steam.exe');
}

function hostPathToWindowsC(hostPath, bottlePath) {
  const driveC = path.resolve(bottlePath, 'drive_c');
  const relative = path.relative(driveC, path.resolve(hostPath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('目标文件不在 Bottle 的 C: 盘内。');
  return `C:\\${relative.split(path.sep).join('\\')}`;
}

function steamWindowsExecutable(bottlePath) {
  let bottleReal;
  let driveCReal;
  let executableReal;
  try {
    bottleReal = fs.realpathSync(path.resolve(bottlePath));
    const driveCLexical = path.join(bottleReal, 'drive_c');
    const driveCStat = fs.lstatSync(driveCLexical);
    if (driveCStat.isSymbolicLink() || !driveCStat.isDirectory()) throw new Error('invalid-drive-c');
    driveCReal = fs.realpathSync(driveCLexical);
    executableReal = fs.realpathSync(steamExecutable(bottleReal));
    if (!fs.statSync(executableReal).isFile()) throw new Error('invalid-steam-exe');
  } catch {
    throw new Error('Bottle 中未找到有效的 Steam 可执行文件。');
  }
  if (!isPathInside(bottleReal, driveCReal) || !isPathInside(driveCReal, executableReal)) {
    throw new Error('Steam 可执行文件不能跳出 Bottle 的 C: 盘。');
  }
  return hostPathToWindowsC(executableReal, bottleReal);
}

function windowsPathToHost(windowsPath, bottlePath) {
  const normalized = windowsPath.replace(/\\\\/g, '\\');
  const match = /^([a-zA-Z]):\\(.*)$/.exec(normalized);
  if (!match) return normalized;
  const drive = match[1].toLowerCase();
  const rest = match[2].split('\\').filter(Boolean);
  if (drive === 'c') return path.join(bottlePath, 'drive_c', ...rest);
  if (drive === 'z') return path.join(path.sep, ...rest);
  const link = path.join(bottlePath, 'dosdevices', `${drive}:`);
  try {
    return path.join(fs.realpathSync(link), ...rest);
  } catch {
    return '';
  }
}

function isPathInside(basePath, targetPath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const RISK_NAMES = [
  ['easy-anticheat', /easyanticheat|easy_anti_cheat/i],
  ['battleye', /battleye|beservice/i],
  ['vanguard', /(^|[\\/])vanguard([\\/]|$)|vgk\.sys$/i],
  ['kernel-driver', /(bedaisy|easyanticheat|eac|faceit|xhunter|mhyprot|ace)[^\\/]*\.sys$/i],
];

async function detectRiskSignals(installPath, { maxDepth = 3, maxEntries = 5000 } = {}) {
  const signals = new Set();
  const queue = [{ directory: installPath, depth: 0 }];
  let seen = 0;
  while (queue.length && seen < maxEntries) {
    const current = queue.shift();
    let entries;
    try { entries = await fsp.readdir(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      seen += 1;
      for (const [signal, pattern] of RISK_NAMES) if (pattern.test(entry.name)) signals.add(signal);
      if (entry.isDirectory() && current.depth < maxDepth && !entry.isSymbolicLink()) {
        queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
      }
      if (seen >= maxEntries) break;
    }
  }
  return [...signals].sort();
}

async function readVdf(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_SIZE) return null;
    return parseVdf(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function findLibraryRoots(bottlePath) {
  const bottleInput = path.resolve(bottlePath);
  let bottleReal;
  let driveCReal;
  try {
    bottleReal = fs.realpathSync(bottleInput);
    driveCReal = fs.realpathSync(path.join(bottleReal, 'drive_c'));
  } catch {
    return [];
  }
  if (!isPathInside(bottleReal, driveCReal)) return [];
  const steamRoot = steamRootForBottle(bottleInput);
  let steamRootReal;
  try { steamRootReal = fs.realpathSync(steamRoot); } catch { return []; }
  if (!isPathInside(driveCReal, steamRootReal)) return [];
  // Return paths using the spelling supplied by the caller. macOS commonly
  // aliases /var to /private/var; canonical paths are still used for checks.
  const roots = new Set([steamRoot]);
  const data = await readVdf(path.join(steamRootReal, 'steamapps/libraryfolders.vdf'));
  const libraries = data?.libraryfolders ?? data?.LibraryFolders ?? {};
  for (const value of Object.values(libraries)) {
    const libraryPath = typeof value === 'string' ? value : value?.path;
    if (!libraryPath) continue;
    const hostPath = windowsPathToHost(libraryPath, bottleInput);
    // A Steam VDF is untrusted input. Do not let Z: or a symlink make a scan
    // walk arbitrary macOS directories without an explicit future opt-in.
    if (!hostPath || !isPathInside(bottleReal, hostPath)) continue;
    try {
      const realHostPath = fs.realpathSync(hostPath);
      if (isPathInside(bottleReal, realHostPath)) roots.add(hostPath);
    } catch {
      // Ignore library paths that do not exist or cannot be resolved safely.
    }
  }
  return [...roots];
}

async function scanGames(bottlePath) {
  const games = [];
  const roots = await findLibraryRoots(bottlePath);
  for (const root of roots) {
    const steamapps = root.endsWith('steamapps') ? root : path.join(root, 'steamapps');
    let entries = [];
    try {
      entries = await fsp.readdir(steamapps, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/^appmanifest_\d+\.acf$/i.test(entry.name)) continue;
      const manifest = await readVdf(path.join(steamapps, entry.name));
      const app = manifest?.AppState ?? manifest?.appstate;
      if (!app?.appid || !app?.name || !/^\d+$/.test(String(app.appid))) continue;
      const bytes = Number(app.SizeOnDisk ?? app.sizeondisk ?? 0);
      const installDir = String(app.installdir ?? '');
      const safeInstallDir = installDir && path.basename(installDir) === installDir ? installDir : '';
      let riskSignals = [];
      if (safeInstallDir) {
        const commonRoot = path.join(steamapps, 'common');
        const installPath = path.join(commonRoot, safeInstallDir);
        try {
          const realInstallPath = fs.realpathSync(installPath);
          if (isPathInside(commonRoot, realInstallPath)) riskSignals = await detectRiskSignals(realInstallPath);
        } catch {
          // Ignore missing or escaped install directories.
        }
      }
      games.push({
        appId: String(app.appid),
        name: String(app.name),
        installDir: safeInstallDir,
        sizeOnDisk: Number.isFinite(bytes) ? bytes : 0,
        fullyInstalled: (Number(app.StateFlags ?? app.stateflags ?? 0) & 4) === 4,
        libraryPath: root,
        artworkUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${app.appid}/header.jpg`,
        riskSignals,
        compatibility: compatibilityFor(app.appid, riskSignals),
      });
    }
  }
  return games.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function downloadToPartial(url, partial, onProgress, redirects) {
  if (redirects > 3) return Promise.reject(new Error('Steam 安装器重定向次数过多。'));
  const trustedUrl = validateSteamDownloadUrl(url);
  return new Promise((resolve, reject) => {
    const request = https.get(trustedUrl, {
      headers: { 'User-Agent': 'SteamBridge/0.1', Accept: 'application/octet-stream' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirect = new URL(response.headers.location, trustedUrl).toString();
        resolve(downloadToPartial(redirect, partial, onProgress, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`下载 Steam 安装器失败：HTTP ${response.statusCode}`));
        return;
      }
      const total = Number(response.headers['content-length'] ?? 0);
      if (total > MAX_INSTALLER_SIZE) {
        response.resume();
        reject(new Error('Steam 安装器大小超过安全上限。'));
        return;
      }
      let received = 0;
      const output = fs.createWriteStream(partial, { mode: 0o600 });
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > MAX_INSTALLER_SIZE) {
            callback(new Error('Steam 安装器大小超过安全上限。'));
            return;
          }
          onProgress(total > 0 ? received / total : null, received, total);
          callback(null, chunk);
        },
      });
      void pipeline(response, meter, output).then(resolve, reject);
    });
    request.setTimeout(30_000, () => request.destroy(new Error('下载 Steam 安装器超时。')));
    request.on('error', reject);
  });
}

async function downloadFile(url, destination, onProgress = () => {}) {
  const partial = `${destination}.part`;
  await fsp.rm(partial, { force: true });
  try {
    await downloadToPartial(url, partial, onProgress, 0);
    await fsp.rename(partial, destination);
  } catch (error) {
    await fsp.rm(partial, { force: true });
    throw error;
  }
}

async function verifyWindowsExecutable(filePath, { expectedSize, expectedSha256 } = {}) {
  const linkStat = await fsp.lstat(filePath);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) throw new Error('下载内容不是普通文件。');
  const stat = await fsp.stat(filePath);
  if (stat.size < 64 || stat.size > MAX_INSTALLER_SIZE) {
    throw new Error('下载内容的文件大小无效。');
  }
  if (expectedSize !== undefined && stat.size !== expectedSize) throw new Error('Steam 安装器大小与已知官方版本不一致。');
  const handle = await fsp.open(filePath, 'r');
  try {
    const dosHeader = Buffer.alloc(64);
    const { bytesRead } = await handle.read(dosHeader, 0, dosHeader.length, 0);
    const peOffset = bytesRead === dosHeader.length ? dosHeader.readUInt32LE(0x3c) : 0;
    const peSignature = Buffer.alloc(4);
    if (peOffset < 64 || peOffset > stat.size - peSignature.length) throw new Error('下载内容不是有效的 PE 文件。');
    await handle.read(peSignature, 0, peSignature.length, peOffset);
    if (dosHeader.subarray(0, 2).toString('ascii') !== 'MZ' || !peSignature.equals(Buffer.from('PE\0\0'))) {
      throw new Error('下载内容不是有效的 Windows 安装程序。');
    }
  } finally {
    await handle.close();
  }
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);
  const sha256 = digest.digest('hex');
  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    throw new Error('Steam 安装器 SHA-256 与已知官方版本不一致，已拒绝执行。');
  }
  return { size: stat.size, sha256 };
}

function verifySteamInstaller(filePath) {
  return verifyWindowsExecutable(filePath, {
    expectedSize: STEAM_INSTALLER_SIZE,
    expectedSha256: STEAM_INSTALLER_SHA256,
  });
}

module.exports = {
  STEAM_DOWNLOAD_URL,
  STEAM_INSTALLER_SHA256,
  STEAM_INSTALLER_SIZE,
  downloadFile,
  detectRiskSignals,
  findLibraryRoots,
  hostPathToWindowsC,
  isPathInside,
  scanGames,
  steamExecutable,
  steamRootForBottle,
  steamWindowsExecutable,
  validateSteamDownloadUrl,
  verifySteamInstaller,
  verifyWindowsExecutable,
  windowsPathToHost,
};
