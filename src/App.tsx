import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Box, Check, CheckCircle2, ChevronRight,
  CircleHelp, Disc3, Download, ExternalLink, FileText, FolderOpen, Gamepad2, HardDrive,
  Info, Library, LoaderCircle, Play, Plus, RefreshCw, Rocket, ScanLine, Search,
  Settings as SettingsIcon, ShieldAlert, Sparkles, Trash2, Wrench, X,
} from 'lucide-react';

type View = 'overview' | 'library' | 'bottles' | 'logs' | 'settings';

const EMPTY_STATE: BootstrapState = {
  settings: { enginePath: '', bottlePath: '', showUninstalled: false },
  platform: {
    platform: { supported: false, name: '', release: '', arch: '', processArch: '', appleSilicon: false, rosetta: null },
    dependencies: { homebrew: { installed: false, path: '' }, engine: { installed: false, path: '', kind: 'none', label: '', notice: '' } },
  },
  bottle: { path: '', exists: false, initialized: false, steamInstalled: false, hostFilesProtected: false },
  bottles: [], backups: [], busy: null,
};

// The Vite preview has no Electron preload bridge. Keep it useful for reviewers
// and screenshots without ever touching the host filesystem or launching a process.
const DEMO_STATE: BootstrapState = {
  settings: { enginePath: '/Applications/Whisky.app/Contents/Resources/wine/bin/wine', bottlePath: '/Users/demo/Library/Application Support/SteamBridge/bottles/Steam', showUninstalled: false },
  platform: {
    platform: { supported: true, name: 'macOS', release: '14.6', arch: 'arm64', processArch: 'arm64', appleSilicon: true, rosetta: true },
    dependencies: { homebrew: { installed: true, path: '/opt/homebrew/bin/brew' }, engine: { installed: true, path: '/Applications/Whisky.app/Contents/Resources/wine/bin/wine', kind: 'whisky', label: 'Whisky', notice: '演示数据' } },
  },
  bottle: { path: '/Users/demo/Library/Application Support/SteamBridge/bottles/Steam', name: 'Steam', exists: true, initialized: true, steamInstalled: true, hostFilesProtected: true },
  bottles: [{ path: '/Users/demo/Library/Application Support/SteamBridge/bottles/Steam', name: 'Steam', exists: true, initialized: true, steamInstalled: true, hostFilesProtected: true }],
  backups: [{ name: 'Steam-2026-08-28', path: '/Users/demo/Library/Application Support/SteamBridge/backups/Steam-2026-08-28', schema: 1, createdAt: '2026-08-28T08:30:00.000Z', sourceName: 'Steam', engineName: 'Whisky', fileCount: 1248, bytes: 4294967296 }],
  busy: null,
};

const DEMO_GAMES: Game[] = [
  { appId: '620', name: 'Portal 2', installDir: 'Portal 2', sizeOnDisk: 8500000000, fullyInstalled: true, libraryPath: '/Users/demo/.../steamapps', artworkUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_600x900_2x.jpg', compatibility: { level: 'untested', label: '待验证', reason: '本地规则库没有足够信息，建议先备份再尝试。' } },
  { appId: '570', name: 'Dota 2', installDir: 'dota 2 beta', sizeOnDisk: 32000000000, fullyInstalled: true, libraryPath: '/Users/demo/.../steamapps', artworkUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/570/library_600x900_2x.jpg', riskSignals: ['反作弊状态需以发行方支持为准'], compatibility: { level: 'caution', label: '谨慎尝试', reason: '在线服务和反作弊支持可能受限，请先确认发行方政策。' } },
  { appId: '730', name: 'Counter-Strike 2', installDir: 'Counter-Strike Global Offensive', sizeOnDisk: 45000000000, fullyInstalled: true, libraryPath: '/Users/demo/.../steamapps', artworkUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_600x900_2x.jpg', riskSignals: ['反作弊/驱动风险'], compatibility: { level: 'blocked', label: '不建议启动', reason: '依赖受保护的反作弊或驱动时，Wine 通常无法提供所需的 Windows 内核环境。' } },
];

function createDemoApi(): SteamBridgeApi {
  let settings = { ...DEMO_STATE.settings };
  return {
    bootstrap: async () => ({ ...DEMO_STATE, settings, bottle: { ...DEMO_STATE.bottle }, bottles: DEMO_STATE.bottles.map((bottle) => ({ ...bottle })) }),
    refreshPlatform: async () => DEMO_STATE.platform,
    updateSettings: async (patch) => { settings = { ...settings, ...patch }; return settings; },
    chooseEngine: async () => settings.enginePath,
    chooseBottle: async () => settings.bottlePath,
    createBottle: async () => DEMO_STATE.bottle,
    createBackup: async () => DEMO_STATE.backups[0],
    restoreBackup: async () => DEMO_STATE.bottle,
    exportBackup: async () => ({ ...DEMO_STATE.backups[0], canceled: false, exportedPath: '/Users/demo/Desktop/Steam-2026-08-28' }),
    importBackup: async () => DEMO_STATE.bottle,
    scanGames: async () => DEMO_GAMES,
    installSteam: async () => DEMO_STATE.bottle,
    launchSteam: async () => ({ pid: 4242 }),
    launchGame: async () => ({ pid: 4243 }),
    openPath: async (selectedPath) => selectedPath,
    openExternal: async () => {},
    readLogs: async () => [{ time: '2026-08-28T08:31:00.000Z', level: 'info', scope: 'system', message: '演示模式：未执行任何本机操作。' }],
    clearLogs: async () => [],
    onEvent: () => () => {},
  };
}

if (!(window as Window & { steamBridge?: SteamBridgeApi }).steamBridge) {
  (window as Window & { steamBridge?: SteamBridgeApi }).steamBridge = createDemoApi();
}

const nav: Array<{ id: View; label: string; icon: typeof Gamepad2 }> = [
  { id: 'overview', label: '概览', icon: Gamepad2 },
  { id: 'library', label: '游戏库', icon: Library },
  { id: 'bottles', label: 'Steam 空间', icon: Box },
  { id: 'logs', label: '运行记录', icon: FileText },
  { id: 'settings', label: '更多设置', icon: SettingsIcon },
];

const ONBOARDING_STORAGE_KEY = 'steambridge-onboarding-v1';

function humanBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function shortPath(value: string) {
  if (!value) return '未设置';
  const parts = value.split('/').filter(Boolean);
  return parts.length > 4 ? `…/${parts.slice(-4).join('/')}` : value;
}

function StatusDot({ ok, neutral = false }: { ok: boolean; neutral?: boolean }) {
  return <span className={`status-dot ${neutral ? 'neutral' : ok ? 'ok' : 'bad'}`} />;
}

function App() {
  const [view, setView] = useState<View>('overview');
  const [state, setState] = useState<BootstrapState>(EMPTY_STATE);
  const [games, setGames] = useState<Game[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [newBottleName, setNewBottleName] = useState('Steam');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [showEngineGuide, setShowEngineGuide] = useState(false);

  const reload = useCallback(async () => {
    const next = await window.steamBridge.bootstrap();
    setState(next);
    setBusy(next.busy);
    return next;
  }, []);

  const scan = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setBusy('扫描游戏库');
      setGames(await window.steamBridge.scanGames());
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!quiet) setBusy(null);
    }
  }, []);

  useEffect(() => {
    Promise.all([reload(), window.steamBridge.readLogs()])
      .then(([next, entries]) => {
        setLogs(entries);
        if (next.bottle.steamInstalled) void scan(true);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
    return window.steamBridge.onEvent((event) => {
      if (event.type === 'operation') setBusy(event.operation ?? null);
      if (event.type === 'download-progress') setDownloadProgress(event.progress ?? null);
      if (event.type === 'log' && event.entry) setLogs((current) => [...current.slice(-499), event.entry!]);
      if (event.type === 'safety-stop' && event.message) setError(event.message);
    });
  }, [reload, scan]);

  useEffect(() => {
    if (!loading && !window.localStorage.getItem(ONBOARDING_STORAGE_KEY)) setShowOnboarding(true);
  }, [loading]);

  const act = async (label: string, action: () => Promise<unknown>, success: string, refresh = true) => {
    setError(''); setNotice(''); setBusy(label);
    try {
      const result = await action();
      if (refresh) await reload();
      if (result === false) return false;
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(null); setDownloadProgress(null);
    }
  };

  const chooseEngine = () => act('选择引擎', async () => {
    const selected = await window.steamBridge.chooseEngine();
    if (!selected) return false;
    await window.steamBridge.updateSettings({ enginePath: selected });
    return true;
  }, '引擎路径已更新。');

  const chooseBottle = () => act('选择 Steam 专用文件夹', async () => {
    const selected = await window.steamBridge.chooseBottle();
    if (!selected) return false;
    await window.steamBridge.updateSettings({ bottlePath: selected });
    return true;
  }, '当前 Steam 专用空间已切换。');

  const createDefaultBottle = () => act('创建 Steam 空间', () => window.steamBridge.createBottle(newBottleName.trim() || 'Steam'), 'Steam 专用空间已创建。');
  const createBackup = () => act('备份 Steam 专用空间', () => window.steamBridge.createBackup(), '备份已完成，更新兼容工具前可以先恢复它。');
  const restoreBackup = (backup: BackupInfo) => {
    if (!window.confirm(`确定要恢复“${backup.name}”吗？\n\n恢复会创建一个新的 Steam 专用文件夹，不会覆盖当前空间。`)) return;
    void act('恢复 Steam 专用空间', () => window.steamBridge.restoreBackup(backup.name), '备份已恢复，当前已切换到新的 Steam 专用空间。');
  };
  const exportBackup = (backup: BackupInfo) => void act('导出 Steam 备份', () => window.steamBridge.exportBackup(backup.name), '备份已导出。请连同整个文件夹一起保存或拷贝到另一台 Mac。');
  const importBackup = () => void act('导入并恢复 Steam 备份', () => window.steamBridge.importBackup(), '备份已导入并恢复，当前已切换到新的 Steam 专用空间。');
  const launchSteam = () => act('打开 Steam', () => window.steamBridge.launchSteam(), 'Steam 已打开。', false);
  const openLibrary = () => setView('library');
  const scanAndOpenLibrary = () => { setView('library'); void scan(); };
  const finishOnboarding = () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete');
    setShowOnboarding(false);
  };
  const skipOnboarding = () => finishOnboarding();
  const onboardingAdvance = () => setOnboardingStep((current) => Math.min(current + 1, 5));
  const onboardingBack = () => setOnboardingStep((current) => Math.max(current - 1, 0));
  const onboardingAction = async (action: () => Promise<boolean>, nextStep: number) => {
    if (await action()) setOnboardingStep(nextStep);
  };

  const filteredGames = useMemo(() => games.filter((game) => {
    const match = game.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || game.appId.includes(query);
    return match && (state.settings.showUninstalled || game.fullyInstalled);
  }), [games, query, state.settings.showUninstalled]);

  if (loading) return <div className="splash"><Disc3 size={36} /><LoaderCircle className="spin" size={24} /><span>正在检查 Mac 和 SteamBridge</span></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Disc3 size={22} /></span><div><strong>SteamBridge</strong><small>macOS 兼容启动器</small></div></div>
        <nav>{nav.map((item) => <button key={item.id} title={item.label} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><item.icon size={18} /><span>{item.label}</span></button>)}</nav>
        <div className="sidebar-status">
          <div><StatusDot ok={state.platform.dependencies.engine.installed} /><span>{state.platform.dependencies.engine.installed ? state.platform.dependencies.engine.label : '未连接引擎'}</span></div>
          <small>{state.bottle.name || '未选择 Steam 空间'}</small>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div><h1>{nav.find((item) => item.id === view)?.label}</h1><p>{view === 'overview' ? '按顺序完成准备，之后就能启动游戏' : view === 'library' ? `${filteredGames.length} 个游戏` : view === 'bottles' ? 'Windows 版 Steam 和游戏存放的位置' : view === 'logs' ? '只保存在本机的诊断记录' : '更改路径和显示选项'}</p></div>
          <div className="top-actions">
            <button className="icon-button" title="重新检测" disabled={Boolean(busy)} onClick={() => act('重新检测', reload, '环境状态已刷新。')}><RefreshCw className={busy ? 'spin' : ''} size={18} /></button>
            {state.bottle.steamInstalled && <button className="primary" disabled={Boolean(busy)} onClick={() => act('启动 Steam', () => window.steamBridge.launchSteam(), 'Steam 已启动。', false)}><Play size={17} fill="currentColor" />启动 Steam</button>}
          </div>
        </header>

        {(error || notice) && <div className={`toast ${error ? 'error' : 'success'}`}><span>{error || notice}</span><button title="关闭" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button></div>}
        {busy && <div className="operation"><LoaderCircle className="spin" size={16} /><span>{busy}</span>{downloadProgress !== null && <strong>{Math.round(downloadProgress * 100)}%</strong>}</div>}

        <section className="content">
          {view === 'overview' && <Overview state={state} games={games} busy={busy} chooseEngine={chooseEngine} chooseBottle={chooseBottle} onCreateBottle={createDefaultBottle} onInstall={() => act('安装 Windows Steam', () => window.steamBridge.installSteam(), 'Windows Steam 已安装。')} onLaunchSteam={launchSteam} onOpenLibrary={openLibrary} onScan={scanAndOpenLibrary} openExternal={(url) => window.steamBridge.openExternal(url)} />}
          {view === 'library' && <LibraryView games={filteredGames} allGames={games} query={query} setQuery={setQuery} settings={state.settings} busy={busy} onScan={() => scan()} onToggle={async (checked) => { const settings = await window.steamBridge.updateSettings({ showUninstalled: checked }); setState((current) => ({ ...current, settings })); }} onLaunch={(game) => act(`启动 ${game.name}`, () => window.steamBridge.launchGame(game.appId), `已请求启动 ${game.name}。`, false)} />}
          {view === 'bottles' && <BottlesView state={state} name={newBottleName} setName={setNewBottleName} busy={busy} onCreate={() => act('创建 Steam 空间', () => window.steamBridge.createBottle(newBottleName), `Steam 专用空间“${newBottleName}”已创建。`)} onSelect={(bottlePath) => act('切换 Steam 空间', () => window.steamBridge.updateSettings({ bottlePath }), '当前 Steam 空间已切换。')} onChoose={chooseBottle} onOpen={() => state.bottle.path && window.steamBridge.openPath(state.bottle.path)} onBackup={createBackup} onRestore={restoreBackup} onExport={exportBackup} onImport={importBackup} />}
          {view === 'logs' && <LogsView logs={logs} onRefresh={async () => setLogs(await window.steamBridge.readLogs())} onClear={async () => setLogs(await window.steamBridge.clearLogs())} />}
          {view === 'settings' && <SettingsView state={state} chooseEngine={chooseEngine} chooseBottle={chooseBottle} onReplayTutorial={() => { setOnboardingStep(0); setShowOnboarding(true); }} onShowEngineGuide={() => setShowEngineGuide(true)} />}
        </section>
      </main>
      {showOnboarding && <OnboardingModal state={state} games={games} step={onboardingStep} busy={busy} onBack={onboardingBack} onSkip={skipOnboarding} onNext={onboardingAdvance} onChooseEngine={() => onboardingAction(chooseEngine, 3)} onCreateBottle={() => onboardingAction(createDefaultBottle, 4)} onInstallSteam={() => onboardingAction(async () => act('安装 Windows Steam', () => window.steamBridge.installSteam(), 'Windows Steam 已安装。'), 5)} onLaunchSteam={() => onboardingAction(async () => act('打开 Steam', () => window.steamBridge.launchSteam(), 'Steam 已打开。', false), 5)} onScanLibrary={() => { window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete'); setShowOnboarding(false); setView('library'); void scan(); }} onOpenExternal={(url) => window.steamBridge.openExternal(url)} onShowEngineGuide={() => setShowEngineGuide(true)} />}
      {showEngineGuide && <EngineGuideModal onClose={() => setShowEngineGuide(false)} onOpenExternal={(url) => window.steamBridge.openExternal(url)} />}
    </div>
  );
}

function OnboardingModal({ state, games, step, busy, onBack, onSkip, onNext, onChooseEngine, onCreateBottle, onInstallSteam, onLaunchSteam, onScanLibrary, onOpenExternal, onShowEngineGuide }: {
  state: BootstrapState;
  games: Game[];
  step: number;
  busy: string | null;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
  onChooseEngine: () => void;
  onCreateBottle: () => void;
  onInstallSteam: () => void;
  onLaunchSteam: () => void;
  onScanLibrary: () => void;
  onOpenExternal: (url: string) => Promise<void>;
  onShowEngineGuide: () => void;
}) {
  const platform = state.platform.platform;
  const engine = state.platform.dependencies.engine;
  const rosettaReady = !platform.appleSilicon || platform.rosetta === true;
  const pages = [
    { icon: Sparkles, kicker: '欢迎使用', title: '用 2 分钟完成第一次设置', body: 'SteamBridge 会带你准备好 Windows Steam。你不需要安装 Windows，也不需要先弄懂 Wine 或 Bottle。', action: '开始设置' },
    { icon: HardDrive, kicker: '第 1 步', title: '先确认这台 Mac 可以运行', body: !platform.supported ? '当前系统不是 macOS，SteamBridge 只能在 macOS 上运行。' : !rosettaReady ? '这是一台 Apple 芯片 Mac，需要安装 Rosetta 2 才能运行部分 Windows 工具。' : '这台 Mac 已满足基本条件。接下来选择一个负责运行 Windows 程序的兼容工具。', action: !rosettaReady ? '查看 Rosetta 说明' : '继续' },
    { icon: Wrench, kicker: '第 2 步', title: '选择一个兼容工具', body: engine.installed ? `已检测到 ${engine.label}。它负责把 Windows 程序转换成 Mac 能运行的形式。` : '先选择已经安装好的 Wine、Whisky 或 CrossOver。SteamBridge 不会替你下载来路不明的程序。', action: engine.installed ? '继续' : '选择兼容工具' },
    { icon: FolderOpen, kicker: '第 3 步', title: '准备 Steam 专用文件夹', body: state.bottle.initialized ? `专用文件夹“${state.bottle.name || 'Steam'}”已经准备好。Windows Steam 和游戏都会放在这里。` : 'SteamBridge 会自动创建一个专用文件夹，用来存放 Windows 版 Steam 和游戏。不会安装 Windows。', action: state.bottle.initialized ? '继续' : '自动创建' },
    { icon: Download, kicker: '第 4 步', title: '安装 Windows 版 Steam', body: state.bottle.steamInstalled ? 'Windows 版 Steam 已安装。下一步是在 Steam 里登录并安装游戏。' : 'SteamBridge 会从 Steam 官方服务器下载 Windows 安装程序，并在刚才的专用文件夹里安装。', action: state.bottle.steamInstalled ? '继续' : '安装 Steam' },
    { icon: ScanLine, kicker: '第 5 步', title: games.length ? '游戏已经找到了' : '登录 Steam 并安装游戏', body: games.length ? `已找到 ${games.length} 个游戏。进入游戏库后，你可以看到兼容性提示并尝试启动。` : '点击“打开 Steam”，登录你的账号并安装游戏。安装完成后回到 SteamBridge，点击“扫描游戏库”。', action: games.length ? '进入游戏库' : '打开 Steam' },
  ];
  const page = pages[Math.max(0, Math.min(step, pages.length - 1))];
  const Icon = page.icon;
  const isFinal = step === pages.length - 1;
  const isBlocked = step === 1 && !platform.supported;
  const action = () => {
    if (step === 0) return onNext();
    if (step === 1) return !rosettaReady ? void onOpenExternal('https://support.apple.com/102527') : onNext();
    if (step === 2) return engine.installed ? onNext() : onChooseEngine();
    if (step === 3) return state.bottle.initialized ? onNext() : onCreateBottle();
    if (step === 4) return state.bottle.steamInstalled ? onNext() : onInstallSteam();
    return games.length ? onScanLibrary() : onLaunchSteam();
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onSkip(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSkip]);
  return <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <div className="onboarding-modal">
      <button className="onboarding-close" title="稍后再看" onClick={onSkip}><X size={17} /></button>
      <div className="onboarding-progress" aria-label={`教程进度 ${step + 1} / ${pages.length}`}>
        <span>{step + 1} / {pages.length}</span>
        <div className="onboarding-progress-track"><i style={{ width: `${((step + 1) / pages.length) * 100}%` }} /></div>
      </div>
      <div className="onboarding-hero" key={step}><span className="onboarding-icon"><Icon size={28} /></span><span className="onboarding-kicker">{page.kicker}</span><h2 id="onboarding-title">{page.title}</h2><p>{page.body}</p></div>
      {step === 0 && <div className="onboarding-note"><ShieldAlert size={16} /><span>提醒：这不是虚拟机。游戏仍以你的 macOS 用户权限运行，请只使用可信的游戏和兼容工具。</span></div>}
      {step === 1 && <div className="onboarding-checks"><div><CheckCircle2 size={16} className={platform.supported ? 'good' : 'bad'} /><span>macOS</span><strong>{platform.supported ? '已确认' : '不支持'}</strong></div><div><CheckCircle2 size={16} className={rosettaReady ? 'good' : 'bad'} /><span>Rosetta 2</span><strong>{!platform.appleSilicon ? 'Intel Mac 无需安装' : rosettaReady ? '已确认' : '需要安装'}</strong></div></div>}
      {step === 2 && engine.installed && <div className="onboarding-note positive"><CheckCircle2 size={16} /><span>已找到可用工具：{engine.label}</span></div>}
      {step === 3 && state.bottle.initialized && <div className="onboarding-note positive"><CheckCircle2 size={16} /><span>专用文件夹：{shortPath(state.bottle.path)}</span></div>}
      {step === 4 && state.bottle.steamInstalled && <div className="onboarding-note positive"><CheckCircle2 size={16} /><span>Windows Steam 已就绪</span></div>}
      <div className="onboarding-footer"><button className="text-button onboarding-skip" onClick={onSkip}>稍后再看</button><div className="onboarding-nav">{step > 0 && <button className="secondary" disabled={Boolean(busy)} onClick={onBack}><ArrowLeft size={16} />上一步</button>}{step === 1 && !rosettaReady && <button className="secondary" disabled={Boolean(busy)} onClick={onNext}>稍后安装</button>}{step === 2 && !engine.installed && <button className="secondary" disabled={Boolean(busy)} onClick={onShowEngineGuide}><Info size={16} />查看安装说明</button>}{isFinal && !games.length && state.bottle.steamInstalled && <button className="secondary" disabled={Boolean(busy)} onClick={onScanLibrary}><ScanLine size={16} />已安装游戏，扫描</button>}<button className="primary" disabled={Boolean(busy) || isBlocked} onClick={isFinal && games.length ? onScanLibrary : action}>{isBlocked ? '请在 macOS 上使用' : page.action}{isFinal && games.length ? <Rocket size={16} /> : <ArrowRight size={16} />}</button></div></div>
    </div>
  </div>;
}

function Overview({ state, games, busy, chooseEngine, chooseBottle, onCreateBottle, onInstall, onLaunchSteam, onOpenLibrary, onScan, openExternal }: {
  state: BootstrapState; games: Game[]; busy: string | null; chooseEngine: () => void; chooseBottle: () => void; onCreateBottle: () => void; onInstall: () => void; onLaunchSteam: () => void; onOpenLibrary: () => void; onScan: () => void; openExternal: (url: string) => Promise<void>;
}) {
  const platform = state.platform.platform;
  const engine = state.platform.dependencies.engine;
  const rosettaReady = !platform.appleSilicon || platform.rosetta === true;
  const platformReady = platform.supported && rosettaReady;
  const steps = [
    {
      title: '准备兼容引擎',
      detail: !platform.supported ? '请在 macOS 上打开 SteamBridge' : !rosettaReady ? 'Apple 芯片需要先安装 Rosetta 2' : engine.installed ? `${engine.label}${engine.version ? ` · ${engine.version}` : ''}` : '先安装 Wine、Whisky 或 CrossOver，再选择引擎',
      done: platformReady && engine.installed,
      blocked: !platform.supported,
      action: !platform.supported ? undefined : !rosettaReady ? () => { void openExternal('https://support.apple.com/102527'); } : !engine.installed ? chooseEngine : undefined,
      actionLabel: !rosettaReady ? '查看安装说明' : '选择引擎',
    },
    {
      title: '为 Windows Steam 准备专用文件夹',
      detail: state.bottle.initialized ? `专用文件夹“${state.bottle.name || 'Steam'}”已准备好` : 'SteamBridge 会自动创建，用来存放 Windows 版 Steam 和游戏；不会安装 Windows',
      done: state.bottle.initialized,
      action: platformReady && engine.installed && !state.bottle.initialized ? onCreateBottle : undefined,
      actionLabel: '自动创建',
    },
    {
      title: '安装 Windows Steam',
      detail: state.bottle.steamInstalled ? 'Windows 版 Steam 已安装' : '从 Steam 官方服务器下载并安装 Windows 版 Steam',
      done: state.bottle.steamInstalled,
      action: state.bottle.initialized && !state.bottle.steamInstalled ? onInstall : undefined,
      actionLabel: '安装 Steam',
    },
    {
      title: '登录并安装游戏',
      detail: state.bottle.steamInstalled ? '点击右上角“启动 Steam”，登录后安装想玩的游戏' : '完成上一步后，在 Windows Steam 中登录并安装游戏',
      done: games.length > 0,
      action: state.bottle.steamInstalled && games.length === 0 ? onLaunchSteam : undefined,
      actionLabel: '启动 Steam',
    },
    {
      title: '扫描并开始游戏',
      detail: games.length > 0 ? `已找到 ${games.length} 个游戏，可以进入游戏库` : '安装游戏后回到这里，扫描 Steam 游戏库',
      done: games.length > 0,
      action: state.bottle.steamInstalled ? games.length > 0 ? onOpenLibrary : onScan : undefined,
      actionLabel: games.length > 0 ? '进入游戏库' : '扫描游戏库',
    },
  ];
  const nextStep = steps.findIndex((step) => !step.done);
  const completed = steps.filter((step) => step.done).length;
  const ready = platformReady && engine.installed && state.bottle.initialized && state.bottle.steamInstalled && games.length > 0;
  const heading = !platform.supported ? '请在 macOS 上运行' : ready ? '可以开始玩了' : nextStep === 0 ? '先准备兼容引擎' : '跟着步骤完成设置';
  return <>
    <section className="welcome-card">
      <div className="welcome-copy"><span className="eyebrow">新手快速开始</span><h2>{heading}</h2><p>{ready ? '环境已准备好，选择一个游戏即可启动。' : '不用理解复杂术语，按下面顺序点击就可以完成准备。'}</p></div>
      <div className="progress-summary"><strong>{completed}/5</strong><span>步骤完成</span></div>
    </section>

    <section className="panel guide-panel">
      <div className="section-heading"><div><h2>按顺序操作</h2><p>当前步骤会显示一个最适合你的按钮</p></div><Wrench size={21} /></div>
      <div className="guide-steps">{steps.map((step, index) => {
        const isCurrent = index === nextStep;
        const showAction = Boolean(step.action) && (isCurrent || (index === steps.length - 1 && ready));
        return <div className={`guide-step ${step.done ? 'done' : isCurrent ? step.blocked ? 'blocked' : 'current' : 'pending'}`} key={step.title}>
          <span className="guide-number">{step.done ? <Check size={15} /> : index + 1}</span>
          <div className="guide-step-copy"><strong>第 {index + 1} 步 · {step.title}</strong><span>{step.detail}</span></div>
          {showAction && <button className="primary guide-action" disabled={Boolean(busy)} onClick={step.action}>{step.actionLabel}<ChevronRight size={16} /></button>}
        </div>;
      })}</div>
    </section>

    <div className="overview-grid">
      <section className="panel environment"><div className="section-heading"><div><h2>运行检查</h2><p>这些项目会在启动前自动检查</p></div></div><div className="check-list">
        <div className="check-row"><StatusDot ok={platform.supported} /><div><strong>macOS</strong><span>{platform.supported ? `${platform.arch} · Darwin ${platform.release}` : `当前为 ${platform.name}`}</span></div></div>
        <div className="check-row"><StatusDot ok={rosettaReady} neutral={!platform.appleSilicon} /><div><strong>Rosetta 2</strong><span>{!platform.appleSilicon ? 'Intel Mac 无需安装' : platform.rosetta ? '已安装' : 'Apple Silicon 需要 Rosetta'}</span></div></div>
        <div className="check-row"><StatusDot ok={engine.installed} /><div><strong>兼容引擎</strong><span>{engine.installed ? engine.label : '未检测到 Wine / Whisky'}</span></div><button className="text-button" onClick={chooseEngine}>更改</button></div>
        <div className="check-row"><StatusDot ok={state.bottle.initialized} /><div><strong>Steam 专用文件夹</strong><span>{state.bottle.initialized ? shortPath(state.bottle.path) : '尚未创建或选择'}</span></div><button className="text-button" onClick={chooseBottle}>选择</button></div>
        <div className="check-row"><StatusDot ok={state.bottle.hostFilesProtected} neutral={!state.bottle.initialized} /><div><strong>主机文件保护</strong><span>{state.bottle.initialized ? state.bottle.hostFilesProtected ? '已移除访问 macOS 根目录的映射' : '这个文件夹仍可访问 macOS 根目录' : '创建 Steam 空间后自动启用'}</span></div></div>
      </div></section>
      <section className="panel limits"><div className="section-heading"><div><h2>开始前请知道</h2><p>兼容层无法绕过系统级要求</p></div><ShieldAlert size={21} /></div><div className="limit-item"><AlertTriangle size={18} /><div><strong>不是 Windows 虚拟机</strong><p>游戏仍在 macOS 用户权限下运行。不要授予完全磁盘访问权限，也不要运行来源不明的补丁或 DLL。</p></div></div><div className="limit-item"><ShieldAlert size={18} /><div><strong>发现主机风险会立即停止</strong><p>如果运行期间发现 Bottle 被改成可访问 macOS 根目录，SteamBridge 会终止 Wine 进程并显示警告。</p></div></div><div className="limit-item"><CircleHelp size={18} /><div><strong>部分游戏无法运行</strong><p>内核驱动、Vanguard，以及未启用 Wine 支持的 BattlEye / EAC 游戏通常不可用。</p></div></div><button className="link-button" onClick={() => openExternal('https://support.apple.com/102527')}>Rosetta 2 安装说明 <ExternalLink size={14} /></button></section>
    </div>
  </>;
}

function LibraryView({ games, allGames, query, setQuery, settings, busy, onScan, onToggle, onLaunch }: {
  games: Game[]; allGames: Game[]; query: string; setQuery: (value: string) => void; settings: Settings; busy: string | null; onScan: () => void; onToggle: (checked: boolean) => void; onLaunch: (game: Game) => void;
}) {
  return <><div className="toolbar"><label className="search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索游戏或 App ID" /></label><label className="toggle"><input type="checkbox" checked={settings.showUninstalled} onChange={(event) => onToggle(event.target.checked)} /><span />显示未完整安装</label><button className="secondary" disabled={Boolean(busy)} onClick={onScan}><RefreshCw size={16} />扫描库</button></div>
    {!allGames.length ? <div className="empty"><Library size={32} /><h2>还没有找到游戏</h2><p>先打开 Windows 版 Steam，登录后安装游戏。安装完成后回到这里点“扫描游戏库”。</p><button className="secondary" onClick={onScan}>扫描游戏库</button></div> : <div className="game-grid">{games.map((game) => <article className="game-card" key={game.appId}><div className="game-art"><img src={game.artworkUrl} alt="" loading="lazy" /><span className={`badge ${game.compatibility.level}`}>{game.compatibility.label}</span></div><div className="game-body"><div><h3 title={game.name}>{game.name}</h3><span>App {game.appId} · {humanBytes(game.sizeOnDisk)}</span></div><p>{game.compatibility.reason}</p><button className="launch-button" disabled={Boolean(busy) || game.compatibility.level === 'blocked' || !game.fullyInstalled} title={game.compatibility.level === 'blocked' ? game.compatibility.reason : '启动游戏'} onClick={() => onLaunch(game)}><Play size={16} fill="currentColor" />{game.compatibility.level === 'blocked' ? '已限制' : game.fullyInstalled ? '启动' : '未完成'}</button></div></article>)}</div>}
  </>;
}

function BottlesView({ state, name, setName, busy, onCreate, onSelect, onChoose, onOpen, onBackup, onRestore, onExport, onImport }: {
  state: BootstrapState; name: string; setName: (value: string) => void; busy: string | null; onCreate: () => void; onSelect: (path: string) => void; onChoose: () => void; onOpen: () => void; onBackup: () => void; onRestore: (backup: BackupInfo) => void; onExport: (backup: BackupInfo) => void; onImport: () => void;
}) {
  return <div className="bottles-layout"><div className="split-view"><section className="panel"><div className="section-heading"><div><h2>Steam 专用空间</h2><p>这里单独保存 Windows 版 Steam 和它安装的游戏。</p></div><button className="icon-button" title="选择已有的 Steam 专用文件夹" onClick={onChoose}><FolderOpen size={18} /></button></div><div className="bottle-list">{state.bottles.length ? state.bottles.map((bottle) => <button key={bottle.path} className={state.bottle.path === bottle.path ? 'selected' : ''} onClick={() => onSelect(bottle.path)}><Box size={19} /><span><strong>{bottle.name}</strong><small>{bottle.steamInstalled ? 'Steam 已安装' : '还没有安装 Steam'}</small></span>{state.bottle.path === bottle.path && <Check size={17} />}</button>) : <div className="inline-empty"><strong>还没有 Steam 专用空间</strong><span>在右侧点“自动创建”，SteamBridge 会替你准备好。</span></div>}</div></section><section className="panel bottle-detail"><div className="section-heading"><div><h2>创建 Steam 专用文件夹</h2><p>用来存放 Windows 版 Steam 和游戏，不会安装 Windows。第一次使用直接自动创建即可。</p></div></div><label className="field"><span>文件夹名称（可选）</span><input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="Steam" /></label><button className="primary full" disabled={Boolean(busy) || !name.trim() || !state.platform.dependencies.engine.installed} onClick={onCreate}><Plus size={17} />自动创建</button><div className="divider" /><div className="current-path"><span>当前使用</span><code>{state.bottle.path || '还没有选择'}</code></div><button className="secondary full" disabled={!state.bottle.path} onClick={onOpen}><FolderOpen size={16} />在 Finder 中打开</button></section></div><section className="panel backup-panel"><div className="section-heading"><div><h2>备份与迁移</h2><p>更新兼容工具前先备份，存档、设置和已安装文件会一起保存。备份可能很大；备份文件未加密，拿到文件的人可能读取 Steam 会话和存档。</p></div><HardDrive size={21} /></div><div className="backup-actions"><button className="primary" disabled={Boolean(busy) || !state.bottle.initialized} onClick={onBackup}><Download size={16} />备份当前空间</button><button className="secondary" disabled={Boolean(busy)} onClick={onImport}><ExternalLink size={16} />从其他 Mac 导入并恢复</button></div>{state.backups.length ? <div className="backup-list">{state.backups.map((backup) => <div className="backup-row" key={backup.path}><div><strong>{new Date(backup.createdAt).toLocaleString('zh-CN', { hour12: false })}</strong><span>{backup.sourceName} · {humanBytes(backup.bytes)} · {backup.fileCount} 个文件</span></div><div className="backup-row-actions"><button className="icon-button" title="恢复到新的 Steam 专用空间" disabled={Boolean(busy)} onClick={() => onRestore(backup)}><RefreshCw size={16} /></button><button className="icon-button" title="导出到其他位置" disabled={Boolean(busy)} onClick={() => onExport(backup)}><ExternalLink size={16} /></button></div></div>)}</div> : <div className="inline-empty">还没有备份。建议在更新 Wine、Whisky 或 CrossOver 前先备份。</div>}</section></div>;
}

function LogsView({ logs, onRefresh, onClear }: { logs: LogEntry[]; onRefresh: () => void; onClear: () => void }) {
  return <section className="log-panel"><div className="log-actions"><span>{logs.length} 条记录</span><div><button className="icon-button" title="刷新日志" onClick={onRefresh}><RefreshCw size={17} /></button><button className="icon-button danger" title="清空日志" onClick={onClear}><Trash2 size={17} /></button></div></div><div className="log-table" role="log">{logs.length ? [...logs].reverse().map((entry, index) => <div className={`log-line ${entry.level}`} key={`${entry.time}-${index}`}><time>{new Date(entry.time).toLocaleString('zh-CN', { hour12: false })}</time><span>{entry.scope}</span><p>{entry.message}</p></div>) : <div className="inline-empty">暂无日志</div>}</div></section>;
}

function SettingsView({ state, chooseEngine, chooseBottle, onReplayTutorial, onShowEngineGuide }: { state: BootstrapState; chooseEngine: () => void; chooseBottle: () => void; onReplayTutorial: () => void; onShowEngineGuide: () => void }) {
  return <div className="settings-list"><section><div><h2>新手教程</h2><p>重新查看第一次使用时的分步说明和操作引导。</p></div><div className="path-control"><span className="settings-ready"><CheckCircle2 size={15} />随时可查看</span><button className="secondary" onClick={onReplayTutorial}><BookOpen size={16} />重新打开教程</button></div></section><section><div><h2>兼容工具安装说明</h2><p>Wine、Whisky 和 CrossOver 是运行 Windows 游戏所需的兼容层，SteamBridge 不会自动执行未知安装命令。</p></div><div className="path-control"><button className="secondary" onClick={onShowEngineGuide}><Info size={16} />查看说明</button></div></section><section><div><h2>运行工具（Wine）</h2><p>选择已安装的 Wine、Whisky 或 CrossOver。没有工具时，请先按上面的说明安装一个。</p></div><div className="path-control"><code>{shortPath(state.settings.enginePath)}</code><button className="secondary" onClick={chooseEngine}><FolderOpen size={16} />选择</button></div></section><section><div><h2>Steam 专用文件夹</h2><p>Windows 版 Steam 和游戏文件存放的位置，技术名称是 Bottle。</p></div><div className="path-control"><code>{shortPath(state.settings.bottlePath)}</code><button className="secondary" onClick={chooseBottle}><FolderOpen size={16} />选择</button></div></section><section><div><h2>主机文件保护</h2><p>SteamBridge 会在每次扫描和启动前移除 Wine 默认的 Z: 根目录映射。这个专用文件夹仍不是 macOS 安全沙箱，请勿授予完全磁盘访问权限。</p></div><span className={`security-state ${state.bottle.hostFilesProtected ? 'on' : ''}`}><StatusDot ok={state.bottle.hostFilesProtected} neutral={!state.bottle.initialized} />{state.bottle.hostFilesProtected ? '已启用' : state.bottle.initialized ? '待修复' : '未创建'}</span></section><section className="about"><div><h2>关于 SteamBridge</h2><p>这是社区兼容启动器，不隶属于 Valve、Apple、CodeWeavers 或 Whisky。Steam 与游戏许可仍由各发行方约束。</p></div><span className="version">0.1.0</span></section></div>;
}

function EngineGuideModal({ onClose, onOpenExternal }: { onClose: () => void; onOpenExternal: (url: string) => Promise<void> }) {
  const guides = [
    { name: 'Wine（Homebrew）', detail: '免费开源的兼容层。适合愿意按官方文档操作的用户。安装后在本页选择 wine 可执行文件。', url: 'https://brew.sh', action: '打开 Homebrew 官网' },
    { name: 'CrossOver', detail: '付费软件，提供图形化安装和商业支持。适合希望少折腾的用户。', url: 'https://www.codeweavers.com/crossover', action: '打开 CrossOver 官网' },
    { name: 'Whisky', detail: '免费图形界面项目，当前已停止积极维护。已有安装可以继续尝试，新用户建议优先选择仍在维护的方案。', url: 'https://getwhisky.app', action: '打开 Whisky 官网' },
    { name: 'Rosetta 2（Apple 芯片）', detail: '部分 Intel 兼容工具需要它。系统弹窗出现时按提示安装即可，不需要下载第三方安装包。', url: 'https://support.apple.com/102527', action: '查看 Apple 说明' },
  ];
  return <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="engine-guide-title"><div className="onboarding-modal engine-guide-modal"><button className="onboarding-close" title="关闭" onClick={onClose}><X size={17} /></button><div className="onboarding-hero"><span className="onboarding-icon"><Wrench size={28} /></span><span className="onboarding-kicker">开始前需要</span><h2 id="engine-guide-title">先安装一个兼容工具</h2><p>它负责把 Windows 程序转换成 macOS 可以运行的形式。SteamBridge 只检测和调用它，不会替你运行来路不明的脚本。</p></div><div className="engine-guide-list">{guides.map((guide) => <div className="engine-guide-row" key={guide.name}><div><strong>{guide.name}</strong><p>{guide.detail}</p></div><button className="secondary" onClick={() => onOpenExternal(guide.url)}>{guide.action}<ExternalLink size={14} /></button></div>)}</div><div className="onboarding-footer"><span className="onboarding-skip">安装完成后回到 SteamBridge，点击“选择兼容工具”。</span><button className="primary" onClick={onClose}>知道了<Check size={16} /></button></div></div></div>;
}

export default App;
