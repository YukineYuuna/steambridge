'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  BACKUP_METADATA_FILE,
  createBackup,
  exportBackup,
  importBackup,
  listBackups,
  readBackupMetadata,
  restoreBackup,
} = require('../electron/lib/backup.cjs');

async function makeBottle(root) {
  const bottle = path.join(root, 'Steam');
  await fsp.mkdir(path.join(bottle, 'drive_c', 'users', 'player'), { recursive: true });
  await fsp.writeFile(path.join(bottle, 'drive_c', 'users', 'player', 'userdata.vdf'), 'save');
  return bottle;
}

test('backup creates metadata and preserves internal symlinks', async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'steambridge-backup-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const bottle = await makeBottle(root);
  if (process.platform !== 'win32') await fsp.symlink('../drive_c', path.join(bottle, 'dosdevices'), 'dir').catch(() => {});
  const backupsRoot = path.join(root, 'backups');
  const backup = await createBackup({ sourcePath: bottle, backupsRoot, enginePath: '/opt/wine/bin/wine' });
  assert.equal(backup.schema, 1);
  assert.ok(backup.fileCount >= 1);
  assert.equal(fs.existsSync(path.join(backup.path, 'drive_c', 'users', 'player', 'userdata.vdf')), true);
  assert.equal(fs.existsSync(path.join(backup.path, BACKUP_METADATA_FILE)), true);
  assert.equal((await listBackups(backupsRoot)).length, 1);
});

test('backup rejects a symlink that leaves the Steam space', async (context) => {
  if (process.platform === 'win32') return;
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'steambridge-backup-link-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const bottle = await makeBottle(root);
  const outside = path.join(root, 'outside.txt');
  await fsp.writeFile(outside, 'secret');
  await fsp.symlink(outside, path.join(bottle, 'drive_c', 'outside.txt'));
  await assert.rejects(createBackup({ sourcePath: bottle, backupsRoot: path.join(root, 'backups') }), /不能跳出允许目录/);
  assert.equal(fs.existsSync(path.join(root, 'backups')), true);
  assert.equal((await fsp.readdir(path.join(root, 'backups'))).length, 0);
});

test('backup rejects symlinked metadata files', async (context) => {
  if (process.platform === 'win32') return;
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'steambridge-backup-meta-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const bottle = await makeBottle(root);
  const backupsRoot = path.join(root, 'backups');
  const backup = await createBackup({ sourcePath: bottle, backupsRoot });
  const outside = path.join(root, 'outside-meta.json');
  await fsp.writeFile(outside, await fsp.readFile(path.join(backup.path, BACKUP_METADATA_FILE)));
  await fsp.rm(path.join(backup.path, BACKUP_METADATA_FILE));
  await fsp.symlink(outside, path.join(backup.path, BACKUP_METADATA_FILE));
  await assert.rejects(readBackupMetadata(backup.path, backupsRoot), /元数据文件不安全/);
});

test('backup rejects a backup root nested inside the Steam space', async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'steambridge-backup-overlap-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'drive_c'), { recursive: true });
  await assert.rejects(createBackup({ sourcePath: root, backupsRoot: path.join(root, 'backups') }), /不能位于 Steam 空间内/);
});

test('restore always creates a new managed Steam space', async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'steambridge-restore-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const bottle = await makeBottle(root);
  const backupsRoot = path.join(root, 'backups');
  const backup = await createBackup({ sourcePath: bottle, backupsRoot });
  const restored = await restoreBackup({ backupPath: backup.path, backupsRoot, bottlesRoot: path.join(root, 'bottles'), name: 'Steam-restored' });
  assert.match(restored.restoredPath, /Steam-restored/);
  assert.equal(fs.existsSync(path.join(restored.restoredPath, 'drive_c', 'users', 'player', 'userdata.vdf')), true);
  await assert.rejects(restoreBackup({ backupPath: backup.path, backupsRoot, bottlesRoot: path.join(root, 'bottles'), name: 'Steam-restored' }), /已存在/);
});

test('restore rejects a truncated backup and removes the partial space', async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'steambridge-restore-integrity-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const bottle = await makeBottle(root);
  const backupsRoot = path.join(root, 'backups');
  const backup = await createBackup({ sourcePath: bottle, backupsRoot });
  await fsp.truncate(path.join(backup.path, 'drive_c', 'users', 'player', 'userdata.vdf'), 1);
  await assert.rejects(
    restoreBackup({ backupPath: backup.path, backupsRoot, bottlesRoot: path.join(root, 'bottles'), name: 'broken' }),
    /备份内容校验失败/,
  );
  assert.equal(fs.existsSync(path.join(root, 'bottles', 'broken')), false);
});

test('export and import preserve a backup without overwriting a destination', async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'steambridge-transfer-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const bottle = await makeBottle(root);
  const backupsRoot = path.join(root, 'backups');
  const backup = await createBackup({ sourcePath: bottle, backupsRoot });
  const exportRoot = path.join(root, 'external');
  const exported = await exportBackup({ backupPath: backup.path, backupsRoot, destinationRoot: exportRoot });
  assert.equal((await readBackupMetadata(exported.exportedPath)).schema, 1);
  const imported = await importBackup({ sourcePath: exported.exportedPath, backupsRoot: path.join(root, 'imported') });
  assert.match(imported.name, /^Imported-/);
  await assert.rejects(exportBackup({ backupPath: backup.path, backupsRoot, destinationRoot: exportRoot }), /已存在/);
  await assert.rejects(exportBackup({ backupPath: backup.path, backupsRoot, destinationRoot: backup.path }), /不能位于备份内容内/);
});
