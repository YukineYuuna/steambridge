'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore, sanitizeSettings } = require('../electron/lib/settings.cjs');

test('settings only persist allowlisted and typed values', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steambridge-settings-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'settings.json');
  const store = new SettingsStore(filePath);
  store.update({ enginePath: '/wine', showUninstalled: true, unknown: 'ignored' });
  const reloaded = new SettingsStore(filePath).get();
  assert.equal(reloaded.enginePath, '/wine');
  assert.equal(reloaded.showUninstalled, true);
  assert.equal(Object.hasOwn(reloaded, 'unknown'), false);
});

test('settings normalize invalid JSON values', () => {
  assert.deepEqual(sanitizeSettings({ enginePath: 42, bottlePath: null, showUninstalled: 'yes' }), {
    enginePath: '', bottlePath: '', showUninstalled: false,
  });
});
