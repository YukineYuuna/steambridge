'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCommand } = require('./runner.cjs');
const { buildSafeChildEnvironment } = require('./security.cjs');

function canExecute(filePath) {
  if (!filePath) return false;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function engineCandidates(homeDir = os.homedir()) {
  return [
    {
      path: path.join(homeDir, 'Library/Application Support/com.isaacmarovitz.Whisky/Libraries/Wine/bin/wine64'),
      kind: 'whisky',
      label: 'WhiskyWine',
      notice: '免费实验性引擎；Whisky 已停止维护，兼容性不会继续更新。',
    },
    {
      path: '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine',
      kind: 'crossover',
      label: 'CrossOver Wine',
      notice: '商业兼容引擎；游戏支持范围取决于 CrossOver 版本。',
    },
    {
      path: '/Applications/Kegworks.app/Contents/SharedSupport/Kegworks/bin/wine64',
      kind: 'kegworks',
      label: 'Kegworks Wine',
      notice: '社区维护的 Wine 封装；请自行确认引擎来源和版本。',
    },
    {
      path: '/opt/homebrew/bin/wine64',
      kind: 'wine',
      label: 'Homebrew Wine',
      notice: '通用 Wine 引擎，3D 游戏兼容性有限。',
    },
    {
      path: '/usr/local/bin/wine64',
      kind: 'wine',
      label: 'Homebrew Wine',
      notice: '通用 Wine 引擎，3D 游戏兼容性有限。',
    },
    {
      path: '/opt/homebrew/bin/wine',
      kind: 'wine',
      label: 'Homebrew Wine',
      notice: '通用 Wine 引擎，3D 游戏兼容性有限。',
    },
    {
      path: '/usr/local/bin/wine',
      kind: 'wine',
      label: 'Homebrew Wine',
      notice: '通用 Wine 引擎，3D 游戏兼容性有限。',
    },
  ];
}

function detectEngine(customPath) {
  if (customPath && canExecute(customPath)) {
    return {
      installed: true,
      path: customPath,
      kind: customPath.includes('com.isaacmarovitz.Whisky') ? 'whisky' : 'custom',
      label: '自定义 Wine',
      notice: '使用手动选择的兼容层；效果取决于该引擎的 DirectX 支持。',
    };
  }
  const found = engineCandidates().find((candidate) => canExecute(candidate.path));
  return found ? { installed: true, ...found } : {
    installed: false,
    path: '',
    kind: 'none',
    label: '未检测到兼容引擎',
    notice: '可安装免费实验性引擎，或手动选择已有的 Wine 引擎。',
  };
}

async function commandWorks(command, args = ['--version']) {
  try {
    await runCommand(command, args, { env: buildSafeChildEnvironment(), inheritEnv: false });
    return true;
  } catch {
    return false;
  }
}

async function getPlatformState(customEnginePath) {
  const isMac = process.platform === 'darwin';
  let hardwareArch = process.arch;
  if (isMac) {
    try {
      const safeEnv = buildSafeChildEnvironment();
      const armCapability = (await runCommand('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'], { env: safeEnv, inheritEnv: false })).stdout.trim();
      hardwareArch = armCapability === '1'
        ? 'arm64'
        : (await runCommand('/usr/bin/uname', ['-m'], { env: safeEnv, inheritEnv: false })).stdout.trim() || process.arch;
    } catch {
      hardwareArch = process.arch;
    }
  }
  const appleSilicon = isMac && hardwareArch === 'arm64';
  let rosetta = null;
  if (appleSilicon) {
    rosetta = process.arch === 'x64'
      ? true
      : await commandWorks('/usr/sbin/pkgutil', ['--pkg-info', 'com.apple.pkg.RosettaUpdateAuto']);
  }
  const brewCandidates = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
  const brewPath = brewCandidates.find(canExecute) ?? '';
  const engine = detectEngine(customEnginePath);
  if (engine.installed) {
    try {
      const version = await runCommand(engine.path, ['--version'], {
        timeout: 10_000,
        env: buildSafeChildEnvironment(),
        inheritEnv: false,
      });
      engine.version = (version.stdout || version.stderr).trim();
    } catch {
      engine.version = '';
    }
  }

  return {
    platform: {
      supported: isMac,
      name: isMac ? 'macOS' : process.platform,
      release: os.release(),
      arch: hardwareArch,
      processArch: process.arch,
      appleSilicon,
      rosetta,
    },
    dependencies: {
      homebrew: { installed: Boolean(brewPath), path: brewPath },
      engine,
    },
  };
}

module.exports = { canExecute, detectEngine, engineCandidates, getPlatformState };
