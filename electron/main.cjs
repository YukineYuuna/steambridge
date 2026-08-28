'use strict';

const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { bottleInfo, createBottle, hardenBottle, listBottles, safeBottleName } = require('./lib/bottles.cjs');
const { compatibilityFor } = require('./lib/compatibility.cjs');
const { AppLogger } = require('./lib/logger.cjs');
const { diagnose, diagnosticMessage } = require('./lib/diagnostics.cjs');
const {
  createBackup,
  exportBackup,
  importBackup,
  listBackups,
  restoreBackup,
} = require('./lib/backup.cjs');
const { getPlatformState } = require('./lib/platform.cjs');
const { runCommand, runDetachedCommand } = require('./lib/runner.cjs');
const {
  assertBottleSafe,
  buildWineEnvironment,
  assertPathInside,
  isTrustedDevelopmentUrl,
  prepareBottleRuntimeDirectories,
  resolveExistingPath,
  validateBottlePath,
  validateEnginePath,
  validateSettingsPatch,
} = require('./lib/security.cjs');
const { SettingsStore } = require('./lib/settings.cjs');
const {
  STEAM_DOWNLOAD_URL,
  downloadFile,
  scanGames,
  steamWindowsExecutable,
  verifySteamInstaller,
} = require('./lib/steam.cjs');

let mainWindow;
let settings;
let logger;
let operation = null;
let uiSession;
const gameCache = new Map();

function sendEvent(type, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('steambridge:event', { type, ...data });
}

function logLine(scope) {
  return (stream, line) => logger.write(stream === 'stderr' ? 'warn' : 'info', scope, line);
}

function annotateDiagnostic(error, context = {}) {
  const diagnostic = diagnose(error, context);
  const result = error instanceof Error ? error : new Error(String(error));
  result.diagnostic = diagnostic;
  result.message = `${result.message}\n${diagnosticMessage(diagnostic)}`;
  return result;
}

function reportSafetyStop(scope, error) {
  const diagnostic = diagnose(error);
  const reason = String(error?.message ?? '安全检查失败。').split('\n')[0];
  const message = `安全停止：${scope}已被终止。\n原因：${reason}\n${diagnostic.advice}`;
  logger.error('safety-stop', message);
  sendEvent('safety-stop', { message });
  if (mainWindow && !mainWindow.isDestroyed()) {
    void dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'SteamBridge 已安全停止',
      message: '检测到可能影响主机数据的运行环境变化，相关进程已终止。',
      detail: message,
      buttons: ['知道了'],
      noLink: true,
    }).catch(() => {});
  }
}

async function requireRuntime() {
  const current = settings.get();
  const bottlePath = validateBottlePath(current.bottlePath);
  const engine = (await getPlatformState(current.enginePath)).dependencies.engine;
  if (!engine.installed) throw new Error('未配置可用的 Wine 引擎。');
  const enginePath = validateEnginePath(engine.path);
  const state = await hardenBottle(bottlePath);
  prepareBottleRuntimeDirectories(bottlePath);
  assertBottleSafe(bottlePath);
  return { current: { ...current, bottlePath, enginePath }, state, safetyGuard: () => assertBottleSafe(bottlePath) };
}

async function appState() {
  const current = settings.get();
  const platform = await getPlatformState(current.enginePath);
  const bottle = bottleInfo(current.bottlePath);
  const bottles = await listBottles(path.join(app.getPath('userData'), 'bottles'));
  const backups = await listBackups(path.join(app.getPath('userData'), 'backups'));
  return { settings: current, platform, bottle, bottles, backups, busy: operation };
}

async function runExclusive(name, task) {
  if (operation) throw new Error(`正在执行“${operation}”，请等待操作完成。`);
  operation = name;
  sendEvent('operation', { operation });
  logger.info('system', `开始：${name}`);
  try {
    const result = await task();
    logger.info('system', `完成：${name}`);
    return result;
  } catch (error) {
    if (error?.code === 'STEAMBRIDGE_SAFETY_STOP' || /安全停止/.test(String(error?.message ?? ''))) reportSafetyStop(name, error);
    logger.error('system', `${name}失败：${error.message}`);
    throw error;
  } finally {
    operation = null;
    sendEvent('operation', { operation: null });
  }
}

function assertTrustedIpc(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('已拒绝非主窗口发起的 IPC 请求。');
  }
}

function handleIpc(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpc(event);
    return handler(event, ...args);
  });
}

function registerIpc() {
  handleIpc('app:bootstrap', appState);
  handleIpc('platform:refresh', async () => getPlatformState(settings.get().enginePath));
  handleIpc('settings:update', async (_event, patch) => {
    const updated = settings.update(validateSettingsPatch(patch));
    logger.info('settings', '设置已更新。');
    return updated;
  });
  handleIpc('dialog:engine', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Wine 可执行文件', properties: ['openFile'],
      defaultPath: '/Applications',
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  handleIpc('dialog:bottle', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择现有 Bottle', properties: ['openDirectory'],
      defaultPath: path.join(app.getPath('userData'), 'bottles'),
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  handleIpc('bottle:create', async (_event, requestedName) => runExclusive('创建 Bottle', async () => {
    const name = safeBottleName(requestedName);
    const current = settings.get();
    const engine = (await getPlatformState(current.enginePath)).dependencies.engine;
    if (!engine.installed) throw new Error('创建 Bottle 前需要安装或选择 Wine 引擎。');
    const bottlesRoot = path.join(app.getPath('userData'), 'bottles');
    await fsp.mkdir(bottlesRoot, { recursive: true, mode: 0o700 });
    await fsp.chmod(bottlesRoot, 0o700);
    const bottlePath = path.join(bottlesRoot, name);
    assertPathInside(bottlesRoot, bottlePath, { label: 'Bottle 路径', rejectSymlinks: true });
    if (fs.existsSync(path.join(bottlePath, 'drive_c'))) throw new Error('同名 Bottle 已存在。');
    const result = await createBottle({
      bottlePath,
      enginePath: engine.path,
      onLine: logLine('wineboot'),
      guard: () => assertBottleSafe(bottlePath, { allowInternalZ: true }),
    });
    settings.update({ bottlePath, enginePath: engine.path });
    return result;
  }));
  handleIpc('backup:create', async () => runExclusive('备份 Steam 专用空间', async () => {
    const { current } = await requireRuntime();
    const backup = await createBackup({
      sourcePath: current.bottlePath,
      backupsRoot: path.join(app.getPath('userData'), 'backups'),
      enginePath: current.enginePath,
    });
    logger.info('backup', `备份已创建：${backup.name}（${backup.fileCount} 个文件，${backup.bytes} 字节）。`);
    return backup;
  }));
  handleIpc('backup:restore', async (_event, backupName) => runExclusive('恢复 Steam 专用空间', async () => {
    const name = String(backupName ?? '');
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) throw new Error('备份名称无效。');
    const backupPath = path.join(app.getPath('userData'), 'backups', name);
    const restored = await restoreBackup({
      backupPath,
      backupsRoot: path.join(app.getPath('userData'), 'backups'),
      bottlesRoot: path.join(app.getPath('userData'), 'bottles'),
      name: `${name}-restored`,
    });
    await hardenBottle(restored.restoredPath);
    settings.update({ bottlePath: restored.restoredPath });
    logger.info('backup', `备份已恢复到新的 Steam 空间：${path.basename(restored.restoredPath)}。`);
    return bottleInfo(restored.restoredPath);
  }));
  handleIpc('backup:export', async (_event, backupName) => runExclusive('导出 Steam 备份', async () => {
    const name = String(backupName ?? '');
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) throw new Error('备份名称无效。');
    const destination = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份导出位置', properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('documents'),
    });
    if (destination.canceled || !destination.filePaths[0]) return { canceled: true };
    const exported = await exportBackup({
      backupPath: path.join(app.getPath('userData'), 'backups', name),
      backupsRoot: path.join(app.getPath('userData'), 'backups'),
      destinationRoot: destination.filePaths[0],
    });
    logger.info('backup', `备份已导出到用户选择的目录（${path.basename(exported.exportedPath)}）。`);
    return exported;
  }));
  handleIpc('backup:import', async () => runExclusive('导入并恢复 Steam 备份', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '选择 SteamBridge 备份文件夹', properties: ['openDirectory'],
      defaultPath: app.getPath('documents'),
    });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    const imported = await importBackup({
      sourcePath: selected.filePaths[0],
      backupsRoot: path.join(app.getPath('userData'), 'backups'),
    });
    const restored = await restoreBackup({
      backupPath: imported.path,
      backupsRoot: path.join(app.getPath('userData'), 'backups'),
      bottlesRoot: path.join(app.getPath('userData'), 'bottles'),
      name: `${imported.name}-restored`,
    });
    await hardenBottle(restored.restoredPath);
    settings.update({ bottlePath: restored.restoredPath });
    logger.info('backup', `外部备份已导入并恢复到：${path.basename(restored.restoredPath)}。`);
    return bottleInfo(restored.restoredPath);
  }));
  handleIpc('games:scan', async () => {
    const { current, state } = await requireRuntime();
    if (!state.steamInstalled) return [];
    const games = await scanGames(current.bottlePath);
    gameCache.clear();
    for (const game of games) gameCache.set(game.appId, game);
    logger.info('library', `扫描到 ${games.length} 个游戏。`);
    return games;
  });
  handleIpc('steam:install', async () => runExclusive('安装 Windows Steam', async () => {
    const { current, safetyGuard } = await requireRuntime();
    const cacheDirectory = path.join(app.getPath('userData'), 'cache');
    const token = crypto.randomUUID();
    const downloadedInstaller = path.join(cacheDirectory, `SteamSetup-${token}.exe`);
    const windowsTemp = path.join(current.bottlePath, 'drive_c', 'windows', 'temp');
    const bottleInstaller = path.join(windowsTemp, `SteamSetup-${token}.exe`);
    const windowsInstaller = `C:\\windows\\temp\\SteamSetup-${token}.exe`;
    await fsp.mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
    await fsp.chmod(cacheDirectory, 0o700);
    await fsp.mkdir(windowsTemp, { recursive: true });
    assertPathInside(current.bottlePath, windowsTemp, { label: 'Steam 安装临时目录', rejectSymlinks: true });
    prepareBottleRuntimeDirectories(current.bottlePath);
    try {
      logger.info('download', '正在从 Steam 官方 CDN 下载安装器。');
      await downloadFile(STEAM_DOWNLOAD_URL, downloadedInstaller, (progress, received, total) => {
        sendEvent('download-progress', { progress, received, total });
      });
      const verification = await verifySteamInstaller(downloadedInstaller);
      assertPathInside(current.bottlePath, windowsTemp, { label: 'Steam 安装临时目录', rejectSymlinks: true });
      await fsp.copyFile(downloadedInstaller, bottleInstaller, fs.constants.COPYFILE_EXCL);
      await verifySteamInstaller(bottleInstaller);
      logger.info('install', `安装器完整性校验通过（SHA-256 ${verification.sha256.slice(0, 12)}…）。`);
      await runCommand(current.enginePath, [windowsInstaller], {
        env: buildWineEnvironment(current.bottlePath), inheritEnv: false,
        onLine: logLine('steam-installer'), timeout: 15 * 60_000, guard: safetyGuard,
      });
      return bottleInfo(current.bottlePath);
    } finally {
      await Promise.allSettled([
        fsp.rm(downloadedInstaller, { force: true }),
        fsp.rm(bottleInstaller, { force: true }),
      ]);
    }
  }));
  handleIpc('steam:launch', async () => {
    let runtime;
    try {
      runtime = await requireRuntime();
    } catch (error) {
      if (/安全停止/.test(String(error?.message ?? ''))) reportSafetyStop('Steam 启动', error);
      const annotated = annotateDiagnostic(error, { operation: 'Steam 启动' });
      logger.error('diagnostic', annotated.message);
      throw annotated;
    }
    const { current, state } = runtime;
    if (!state.steamInstalled) throw new Error('当前 Bottle 中尚未安装 Steam。');
    let result;
    try {
      result = await runDetachedCommand(current.enginePath, [steamWindowsExecutable(current.bottlePath), '-silent'], {
        env: buildWineEnvironment(current.bottlePath, { WINEDEBUG: 'err+all' }),
        inheritEnv: false,
        onLine: logLine('steam-launch'),
        startupProbe: 2_500,
        guard: runtime.safetyGuard,
        onSafetyFailure: (error) => reportSafetyStop('Steam 运行', error),
      });
    } catch (error) {
      if (error?.code === 'STEAMBRIDGE_SAFETY_STOP' || /安全停止/.test(String(error?.message ?? ''))) reportSafetyStop('Steam 启动', error);
      const annotated = annotateDiagnostic(error, { operation: 'Steam 启动' });
      logger.error('diagnostic', annotated.message);
      throw annotated;
    }
    logger.info('launch', `Steam 已启动（PID ${result.pid}）。`);
    return result;
  });
  handleIpc('game:launch', async (_event, appId) => {
    const normalized = String(appId ?? '');
    if (!/^\d+$/.test(normalized)) throw new Error('无效的 Steam App ID。');
    let runtime;
    try {
      runtime = await requireRuntime();
    } catch (error) {
      if (/安全停止/.test(String(error?.message ?? ''))) reportSafetyStop('游戏启动', error);
      const annotated = annotateDiagnostic(error, { operation: '游戏启动' });
      logger.error('diagnostic', annotated.message);
      throw annotated;
    }
    const { current, state } = runtime;
    if (!gameCache.has(normalized)) {
      for (const game of await scanGames(current.bottlePath)) gameCache.set(game.appId, game);
    }
    const game = gameCache.get(normalized);
    const compatibility = game?.compatibility ?? compatibilityFor(normalized);
    if (compatibility.level === 'blocked') throw new Error(`已阻止启动：${compatibility.reason}`);
    if (compatibility.level === 'caution') {
      const decision = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '在线兼容性风险',
        message: compatibility.reason,
        detail: '不要禁用或绕过反作弊。继续仅表示启动游戏，不代表受保护在线服务器允许 Wine。',
        buttons: ['取消', '仍要启动'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (decision.response !== 1) return { canceled: true };
    }
    if (!state.steamInstalled) throw new Error('当前 Bottle 中尚未安装 Steam。');
    let result;
    try {
      result = await runDetachedCommand(current.enginePath, [steamWindowsExecutable(current.bottlePath), '-applaunch', normalized], {
        env: buildWineEnvironment(current.bottlePath, { WINEDEBUG: 'err+all' }),
        inheritEnv: false,
        onLine: logLine('game-launch'),
        startupProbe: 2_500,
        guard: runtime.safetyGuard,
        onSafetyFailure: (error) => reportSafetyStop('游戏运行', error),
      });
    } catch (error) {
      if (error?.code === 'STEAMBRIDGE_SAFETY_STOP' || /安全停止/.test(String(error?.message ?? ''))) reportSafetyStop('游戏启动', error);
      const annotated = annotateDiagnostic(error, {
        operation: '游戏启动',
        gameName: game?.name,
        riskSignals: game?.riskSignals,
      });
      logger.error('diagnostic', annotated.message);
      throw annotated;
    }
    logger.info('launch', `已请求启动 App ${normalized}（PID ${result.pid}）。`);
    return result;
  });
  handleIpc('shell:open-path', async (_event, target) => {
    const allowed = [settings.get().bottlePath, app.getPath('logs')].filter(Boolean).map((item) => path.resolve(item));
    if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0')) throw new Error('路径无效。');
    const resolved = resolveExistingPath(target);
    const realAllowed = allowed.map((base) => resolveExistingPath(base));
    const inside = (base, candidate) => {
      const relative = path.relative(base, candidate);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    };
    if (!realAllowed.some((base) => inside(base, resolved))) throw new Error('不允许打开该路径。');
    return shell.openPath(resolved);
  });
  handleIpc('shell:open-external', async (_event, target) => {
    const url = new URL(String(target));
    const allowedHosts = new Set(['support.apple.com', 'brew.sh', 'www.winehq.org', 'getwhisky.app', 'www.codeweavers.com']);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('不允许打开该网址。');
    await shell.openExternal(url.toString());
  });
  handleIpc('logs:read', (_event, limit) => logger.read(limit));
  handleIpc('logs:clear', () => { logger.clear(); return []; });
}

function isAllowedUiRequest(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') return app.isPackaged;
    if (url.protocol === 'data:') return true;
    if (url.protocol === 'about:' && url.href === 'about:blank') return true;
    if (url.protocol === 'blob:' || url.protocol === 'devtools:') return !app.isPackaged;
    if ((url.protocol === 'http:' || url.protocol === 'ws:') && url.hostname === '127.0.0.1' && url.port === '5173') {
      return !app.isPackaged;
    }
    return url.protocol === 'https:' && new Set([
      'cdn.cloudflare.steamstatic.com',
      'shared.cloudflare.steamstatic.com',
    ]).has(url.hostname);
  } catch {
    return false;
  }
}

function configureUiSession(targetSession) {
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  targetSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedUiRequest(details.url) });
  });
  if (app.isPackaged) {
    const policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.cloudflare.steamstatic.com https://shared.cloudflare.steamstatic.com; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    targetSession.webRequest.onHeadersReceived((details, callback) => callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    }));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240, height: 800, minWidth: 960, minHeight: 640,
    title: 'SteamBridge', backgroundColor: '#0d1015', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      session: uiSession,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl && isTrustedDevelopmentUrl(developmentUrl)) mainWindow.loadURL(developmentUrl);
  else if (developmentUrl) throw new Error('开发服务器地址不受信任。');
  else mainWindow.loadURL(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString());
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  uiSession = session.fromPartition('steambridge-ui', { cache: false });
  configureUiSession(uiSession);
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  logger = new AppLogger(path.join(app.getPath('logs'), 'steambridge.log'), (entry) => sendEvent('log', { entry }));
  registerIpc();
  createWindow();
  logger.info('system', `SteamBridge ${app.getVersion()} 已启动。`);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
