'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  enginePath: '',
  bottlePath: '',
  showUninstalled: false,
});

function sanitizeSettings(input = {}) {
  return {
    enginePath: typeof input.enginePath === 'string' ? input.enginePath : '',
    bottlePath: typeof input.bottlePath === 'string' ? input.bottlePath : '',
    showUninstalled: input.showUninstalled === true,
  };
}

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = sanitizeSettings({ ...DEFAULTS, ...parsed });
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not read settings:', error.message);
    }
  }

  get() {
    return { ...this.data };
  }

  update(patch) {
    const allowed = ['enginePath', 'bottlePath', 'showUninstalled'];
    for (const key of allowed) {
      if (Object.hasOwn(patch, key)) this.data[key] = sanitizeSettings({ ...this.data, [key]: patch[key] })[key];
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
    return this.get();
  }
}

module.exports = { SettingsStore, DEFAULTS, sanitizeSettings };
