'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('steamBridge', {
  bootstrap: invoke('app:bootstrap'),
  refreshPlatform: invoke('platform:refresh'),
  updateSettings: invoke('settings:update'),
  chooseEngine: invoke('dialog:engine'),
  chooseBottle: invoke('dialog:bottle'),
  createBottle: invoke('bottle:create'),
  createBackup: invoke('backup:create'),
  restoreBackup: invoke('backup:restore'),
  exportBackup: invoke('backup:export'),
  importBackup: invoke('backup:import'),
  scanGames: invoke('games:scan'),
  installSteam: invoke('steam:install'),
  launchSteam: invoke('steam:launch'),
  launchGame: invoke('game:launch'),
  openPath: invoke('shell:open-path'),
  openExternal: invoke('shell:open-external'),
  readLogs: invoke('logs:read'),
  clearLogs: invoke('logs:clear'),
  onEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('steambridge:event', listener);
    return () => ipcRenderer.removeListener('steambridge:event', listener);
  },
});
