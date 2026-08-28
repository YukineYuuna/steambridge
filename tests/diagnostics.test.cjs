'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDiagnostic, diagnose, diagnosticMessage } = require('../electron/lib/diagnostics.cjs');

test('diagnostics classify common startup failures', () => {
  const cases = [
    ['permission', new Error('EACCES: permission denied, open bottle')],
    ['missingDll', new Error('err:module:import_dll Library vcruntime140.dll not found')],
    ['graphics', new Error('D3D12CreateDevice failed: dxgi initialization error')],
    ['launcher', new Error('steamwebhelper bootstrap launcher exited')],
    ['antiCheat', new Error('failed to load vgk.sys anti-cheat driver')],
  ];
  for (const [expected, error] of cases) assert.equal(classifyDiagnostic(error), expected);
});

test('diagnostics prefer explicit anti-cheat risk signals and provide Chinese advice', () => {
  const result = diagnose(new Error('game exited'), { riskSignals: ['kernel-driver'] });
  assert.equal(result.category, 'antiCheat');
  assert.match(diagnosticMessage(result), /不要关闭、修改或绕过反作弊/);
  assert.equal(classifyDiagnostic(new Error('err:module vcruntime140.dll not found'), { riskSignals: ['easy-anticheat'] }), 'missingDll');
});

test('diagnostics classify missing or unusable runtime paths as permission/location issues', () => {
  assert.equal(classifyDiagnostic(new Error('所选 Bottle 目录不存在。'), { operation: '游戏启动' }), 'permission');
  assert.equal(classifyDiagnostic(new Error('所选 Wine 引擎不可执行。'), { operation: 'Steam 启动' }), 'permission');
});
