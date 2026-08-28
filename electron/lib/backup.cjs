'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { assertPathInside, validateBottlePath } = require('./security.cjs');
const { safeBottleName } = require('./bottles.cjs');

const BACKUP_SCHEMA = 1;
const BACKUP_METADATA_FILE = '.steambridge-backup.json';

function backupMetadataPath(backupPath) {
  return path.join(backupPath, BACKUP_METADATA_FILE);
}

function ensureDirectory(rootPath, label) {
  const resolved = path.resolve(rootPath);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  fs.chmodSync(resolved, 0o700);
  return assertPathInside(resolved, resolved, { label, rejectSymlinks: true });
}

function assertNewDirectory(targetPath, label) {
  try {
    fs.lstatSync(targetPath);
    throw new Error(`${label}已存在，为避免覆盖已拒绝操作。`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function isWithin(basePath, targetPath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function copyTreeSecure(sourcePath, targetPath, sourceRoot, options = {}) {
  const skipNames = options.skipNames ?? new Set();
  const entries = await fsp.readdir(sourcePath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  let fileCount = 0;
  let bytes = 0;
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const source = path.join(sourcePath, entry.name);
    const target = path.join(targetPath, entry.name);
    const stat = await fsp.lstat(source);
    if (stat.isSymbolicLink()) {
      const linkTarget = await fsp.readlink(source);
      const resolvedTarget = path.resolve(path.dirname(source), linkTarget);
      try {
        assertPathInside(sourceRoot, resolvedTarget, { label: `备份符号链接 ${entry.name}` });
      } catch (error) {
        if (/不在允许目录内/.test(String(error.message))) throw new Error(`备份符号链接 ${entry.name}不能跳出允许目录。`);
        throw error;
      }
      await fsp.symlink(linkTarget, target, process.platform === 'win32' ? 'junction' : undefined);
      continue;
    }
    if (stat.isDirectory()) {
      await fsp.mkdir(target, { recursive: false, mode: 0o700 });
      assertPathInside(sourceRoot, source, { label: `备份目录 ${entry.name}`, rejectSymlinks: true });
      const nested = await copyTreeSecure(source, target, sourceRoot, options);
      fileCount += nested.fileCount;
      bytes += nested.bytes;
      continue;
    }
    if (!stat.isFile()) throw new Error(`备份包含不支持的文件类型：${entry.name}`);
    await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    try { await fsp.chmod(target, stat.mode & 0o777); } catch { /* best effort on filesystems without POSIX modes */ }
    fileCount += 1;
    bytes += stat.size;
  }
  return { fileCount, bytes };
}

function validateMetadata(metadata, backupPath) {
  if (!metadata || metadata.schema !== BACKUP_SCHEMA || typeof metadata.createdAt !== 'string'
    || typeof metadata.sourceName !== 'string' || !Number.isSafeInteger(metadata.fileCount)
    || !Number.isSafeInteger(metadata.bytes) || metadata.fileCount < 0 || metadata.bytes < 0) {
    throw new Error('备份元数据无效或版本不受支持。');
  }
  return {
    ...metadata,
    name: path.basename(backupPath),
    path: backupPath,
  };
}

function assertStatsMatch(stats, metadata) {
  if (stats.fileCount !== metadata.fileCount || stats.bytes !== metadata.bytes) {
    throw new Error(`备份内容校验失败：期望 ${metadata.fileCount} 个文件/${metadata.bytes} 字节，实际 ${stats.fileCount} 个文件/${stats.bytes} 字节。`);
  }
}

async function readBackupMetadata(backupPath, backupsRoot = null) {
  const resolved = path.resolve(backupPath);
  if (backupsRoot) assertPathInside(backupsRoot, resolved, { label: '备份路径', rejectSymlinks: true });
  const stat = await fsp.lstat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('备份文件夹不存在。');
  const metadataPath = backupMetadataPath(resolved);
  const metadataStat = await fsp.lstat(metadataPath).catch(() => null);
  if (!metadataStat?.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > 64 * 1024) {
    throw new Error('备份元数据文件不安全。');
  }
  assertPathInside(resolved, metadataPath, { label: '备份元数据', rejectSymlinks: true });
  const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
  return validateMetadata(metadata, resolved);
}

async function listBackups(backupsRoot) {
  let entries;
  try { entries = await fsp.readdir(backupsRoot, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try { result.push(await readBackupMetadata(path.join(backupsRoot, entry.name), backupsRoot)); } catch { /* ignore incomplete or foreign directories */ }
  }
  return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function createBackup({ sourcePath, backupsRoot, enginePath = '' }) {
  const source = validateBottlePath(sourcePath);
  if (isWithin(source, backupsRoot)) throw new Error('备份目录不能位于 Steam 空间内。');
  const root = ensureDirectory(backupsRoot, '备份目录');
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const name = `Steam-${stamp}-${randomUUID().slice(0, 8)}`;
  const destination = path.join(root, name);
  assertNewDirectory(destination, '备份目标');
  await fsp.mkdir(destination, { mode: 0o700 });
  try {
    const stats = await copyTreeSecure(source, destination, source, {
      skipNames: new Set([BACKUP_METADATA_FILE]),
    });
    const metadata = {
      schema: BACKUP_SCHEMA,
      createdAt: new Date().toISOString(),
      sourceName: path.basename(source),
      engineName: enginePath ? path.basename(enginePath) : '',
      fileCount: stats.fileCount,
      bytes: stats.bytes,
    };
    await fsp.writeFile(backupMetadataPath(destination), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return validateMetadata(metadata, destination);
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function restoreBackup({ backupPath, backupsRoot, bottlesRoot, name }) {
  const metadata = await readBackupMetadata(backupPath, backupsRoot);
  if (isWithin(backupPath, bottlesRoot)) throw new Error('恢复目录不能位于备份内容内。');
  const root = ensureDirectory(bottlesRoot, 'Steam 空间目录');
  const requested = safeBottleName(name || `${metadata.sourceName || 'Steam'}-restored`);
  const destination = path.join(root, requested);
  assertPathInside(root, destination, { label: '恢复目标', rejectSymlinks: true });
  assertNewDirectory(destination, '恢复目标');
  await fsp.mkdir(destination, { mode: 0o700 });
  try {
    const stats = await copyTreeSecure(path.resolve(backupPath), destination, path.resolve(backupPath), {
      skipNames: new Set([BACKUP_METADATA_FILE]),
    });
    assertStatsMatch(stats, metadata);
    const restored = validateBottlePath(destination);
    return { ...metadata, restoredPath: restored };
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function exportBackup({ backupPath, backupsRoot, destinationRoot }) {
  const metadata = await readBackupMetadata(backupPath, backupsRoot);
  if (isWithin(backupPath, destinationRoot)) throw new Error('导出目录不能位于备份内容内。');
  const root = ensureDirectory(destinationRoot, '导出目录');
  const destination = path.join(root, path.basename(backupPath));
  assertNewDirectory(destination, '导出目标');
  await fsp.mkdir(destination, { mode: 0o700 });
  try {
    const stats = await copyTreeSecure(path.resolve(backupPath), destination, path.resolve(backupPath), {
      skipNames: new Set([BACKUP_METADATA_FILE]),
    });
    assertStatsMatch(stats, metadata);
    await fsp.writeFile(backupMetadataPath(destination), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return { ...metadata, exportedPath: destination };
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function importBackup({ sourcePath, backupsRoot }) {
  const source = path.resolve(sourcePath);
  const metadata = await readBackupMetadata(source);
  const root = ensureDirectory(backupsRoot, '备份目录');
  const name = `Imported-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const destination = path.join(root, name);
  assertNewDirectory(destination, '导入目标');
  await fsp.mkdir(destination, { mode: 0o700 });
  try {
    const stats = await copyTreeSecure(source, destination, source, {
      skipNames: new Set([BACKUP_METADATA_FILE]),
    });
    assertStatsMatch(stats, metadata);
    const imported = { ...metadata, importedAt: new Date().toISOString() };
    await fsp.writeFile(backupMetadataPath(destination), `${JSON.stringify(imported, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return validateMetadata(imported, destination);
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  BACKUP_METADATA_FILE,
  BACKUP_SCHEMA,
  createBackup,
  exportBackup,
  importBackup,
  listBackups,
  readBackupMetadata,
  restoreBackup,
};
