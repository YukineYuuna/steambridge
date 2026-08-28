'use strict';

const BLOCKED_GAMES = new Map([
  ['1085660', '该游戏的 BattlEye 策略会阻止兼容层运行。'],
  ['1172470', '该游戏的反作弊当前不允许通过 Wine 进入在线模式。'],
  ['1938090', '内核级反作弊不支持 Wine。'],
  ['252490', '官方服务器的 Easy Anti-Cheat 不支持 Wine。'],
  ['359550', 'BattlEye 在线模式通常无法通过兼容层运行。'],
  ['578080', 'BattlEye 在线模式通常无法通过兼容层运行。'],
  ['1240440', '多人模式的反作弊支持不稳定。'],
  ['1599340', 'Easy Anti-Cheat 配置不允许 Wine。'],
]);

const CAUTION_GAMES = new Map([
  ['730', '可启动性会随更新变化；部分图形选项和第三方反作弊服务器可能不可用。'],
  ['271590', '在线模式、启动器更新及反作弊策略可能阻止运行。'],
  ['381210', 'Easy Anti-Cheat 是否可用取决于发行方当前配置。'],
]);

function compatibilityFor(appId, riskSignals = []) {
  const reason = BLOCKED_GAMES.get(String(appId));
  if (reason) return { level: 'blocked', label: '不可用', reason };
  if (riskSignals.includes('kernel-driver')) {
    return { level: 'blocked', label: '驱动受限', reason: '安装目录包含已知 Windows 内核驱动，Wine 无法安全加载。' };
  }
  if (riskSignals.includes('vanguard')) {
    return { level: 'blocked', label: '反作弊受限', reason: '检测到 Vanguard 组件；该反作弊要求 Windows 内核环境。' };
  }
  if (riskSignals.includes('easy-anticheat') || riskSignals.includes('battleye')) {
    const product = riskSignals.includes('easy-anticheat') ? 'Easy Anti-Cheat' : 'BattlEye';
    return { level: 'caution', label: '在线高风险', reason: `检测到 ${product}；只有发行方明确启用 Wine 支持时才能进入受保护服务器。` };
  }
  const caution = CAUTION_GAMES.get(String(appId));
  if (caution) return { level: 'caution', label: '谨慎', reason: caution };
  return {
    level: 'untested',
    label: '待验证',
    reason: '能否运行取决于游戏版本、图形 API 和反作弊策略。首次启动后再判断。',
  };
}

module.exports = { BLOCKED_GAMES, CAUTION_GAMES, compatibilityFor };
