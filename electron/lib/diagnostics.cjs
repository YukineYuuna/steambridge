'use strict';

const DIAGNOSTIC_CATEGORIES = Object.freeze({
  permission: {
    label: '权限或文件位置',
    title: '无法访问文件或目录',
    advice: '请确认运行工具和 Steam 专用文件夹仍然存在，并且当前 macOS 用户拥有读写权限。不要授予完全磁盘访问权限。',
  },
  antiCheat: {
    label: '反作弊或驱动',
    title: '游戏需要 Windows 反作弊或驱动',
    advice: 'Wine 不能加载 Windows 内核驱动。不要关闭、修改或绕过反作弊；请尝试单人模式或查阅发行方是否明确支持 Wine。',
  },
  missingDll: {
    label: '缺少 Windows 组件',
    title: '可能缺少 DLL 或运行库',
    advice: '查看游戏官方运行库要求，优先使用兼容工具提供的依赖安装功能。不要从陌生网站下载 DLL 覆盖到游戏目录。',
  },
  graphics: {
    label: '图形 API 或驱动',
    title: '图形接口初始化失败',
    advice: '请更新 macOS 和兼容工具，尝试切换 DirectX 版本或图形后端；DirectX 12、Vulkan 和光追功能可能不受支持。',
  },
  launcher: {
    label: 'Steam 或游戏启动器',
    title: '启动器没有完成启动',
    advice: '先单独打开 Windows Steam，等待更新完成后再启动游戏。第三方启动器、网页登录和 DRM 可能不兼容 Wine。',
  },
  unknown: {
    label: '未知原因',
    title: '程序启动失败',
    advice: '请查看“运行记录”中的完整错误，确认游戏版本和兼容工具版本；同一游戏更新后可能需要重新测试。',
  },
});

function flattenDiagnosticText(error, context = {}) {
  const values = [
    error?.message,
    error?.result?.stderr,
    error?.result?.stdout,
    context.operation,
    context.gameName,
    ...(Array.isArray(context.riskSignals) ? context.riskSignals : []),
  ];
  return values.filter((value) => value !== undefined && value !== null).map(String).join('\n').toLowerCase();
}

function errorOnlyText(error) {
  return [error?.message, error?.result?.stderr, error?.result?.stdout]
    .filter((value) => value !== undefined && value !== null).map(String).join('\n').toLowerCase();
}

function classifyDiagnostic(error, context = {}) {
  const text = flattenDiagnosticText(error, context);
  const rawErrorText = errorOnlyText(error);
  const riskSignals = new Set(context.riskSignals ?? []);
  if (/安全停止|主机根目录映射|对其他用户开放|Bottle.*外部/i.test(rawErrorText)) return 'permission';
  const hasTechnicalFailure = /eacces|eperm|permission denied|operation not permitted|access denied|read[- ]only|not permitted|权限|无权|拒绝访问|不可执行|路径.*不存在|目录.*不存在|err:module|module .* not found|cannot find .*\.dll|failed to load|msvcp\d+|vcruntime\d+|api-ms-win|0xc0000135|dll|d3d|directx|dxgi|d3dcompiler|vulkan|opengl|metal|wine\s*[- ]?d3d|shader|gpu|graphics|0xc000007b/i.test(rawErrorText);
  if (/anti[- ]?cheat|battlEye|easyanticheat|vanguard|vgk\.sys|bedaisy\.sys|kernel driver/i.test(rawErrorText)
    || (!hasTechnicalFailure && (riskSignals.has('kernel-driver') || riskSignals.has('vanguard') || riskSignals.has('easy-anticheat') || riskSignals.has('battleye')))) {
    return 'antiCheat';
  }
  if (/eacces|eperm|permission denied|operation not permitted|access denied|read[- ]only|not permitted|权限|无权|拒绝访问|不可执行|路径.*不存在|目录.*不存在/i.test(text)) {
    return 'permission';
  }
  if (/err:module|module .* not found|cannot find .*\.dll|failed to load|msvcp\d+|vcruntime\d+|api-ms-win|0xc0000135|dll/i.test(text)) {
    return 'missingDll';
  }
  if (/d3d|directx|dxgi|d3dcompiler|vulkan|opengl|metal|wine\s*[- ]?d3d|shader|gpu|graphics|0xc000007b/i.test(text)) {
    return 'graphics';
  }
  if (/steam|steamwebhelper|cef|launcher|updat|bootstrap|social club|rockstar|epic|origin|uplay|battle\.net/i.test(text)) {
    return 'launcher';
  }
  return 'unknown';
}

function diagnose(error, context = {}) {
  const category = classifyDiagnostic(error, context);
  const definition = DIAGNOSTIC_CATEGORIES[category];
  return {
    category,
    label: definition.label,
    title: definition.title,
    advice: definition.advice,
    rawMessage: String(error?.message ?? error ?? ''),
  };
}

function diagnosticMessage(diagnostic) {
  return `诊断：${diagnostic.label}。${diagnostic.advice}`;
}

module.exports = {
  DIAGNOSTIC_CATEGORIES,
  classifyDiagnostic,
  diagnosticMessage,
  diagnose,
};
