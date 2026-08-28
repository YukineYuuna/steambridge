/// <reference types="vite/client" />

type CompatibilityLevel = 'blocked' | 'caution' | 'untested';

interface Compatibility {
  level: CompatibilityLevel;
  label: string;
  reason: string;
}

interface Game {
  appId: string;
  name: string;
  installDir: string;
  sizeOnDisk: number;
  fullyInstalled: boolean;
  libraryPath: string;
  artworkUrl: string;
  riskSignals?: string[];
  compatibility: Compatibility;
}

interface EngineState {
  installed: boolean;
  path: string;
  kind: string;
  label: string;
  notice: string;
  version?: string;
}

interface PlatformState {
  platform: {
    supported: boolean;
    name: string;
    release: string;
    arch: string;
    processArch: string;
    appleSilicon: boolean;
    rosetta: boolean | null;
  };
  dependencies: {
    homebrew: { installed: boolean; path: string };
    engine: EngineState;
  };
}

interface BottleInfo {
  path: string;
  name?: string;
  exists: boolean;
  initialized: boolean;
  steamInstalled: boolean;
  hostFilesProtected: boolean;
}

interface BackupInfo {
  name: string;
  path: string;
  schema: number;
  createdAt: string;
  sourceName: string;
  engineName: string;
  fileCount: number;
  bytes: number;
  importedAt?: string;
}

interface Settings {
  enginePath: string;
  bottlePath: string;
  showUninstalled: boolean;
}

interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
}

interface BootstrapState {
  settings: Settings;
  platform: PlatformState;
  bottle: BottleInfo;
  bottles: BottleInfo[];
  backups: BackupInfo[];
  busy: string | null;
}

interface BridgeEvent {
  type: 'operation' | 'download-progress' | 'log' | 'safety-stop';
  operation?: string | null;
  progress?: number | null;
  received?: number;
  total?: number;
  entry?: LogEntry;
  message?: string;
}

interface SteamBridgeApi {
  bootstrap(): Promise<BootstrapState>;
  refreshPlatform(): Promise<PlatformState>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  chooseEngine(): Promise<string>;
  chooseBottle(): Promise<string>;
  createBottle(name: string): Promise<BottleInfo>;
  createBackup(): Promise<BackupInfo>;
  restoreBackup(name: string): Promise<BottleInfo>;
  exportBackup(name: string): Promise<BackupInfo & { canceled?: boolean; exportedPath?: string }>;
  importBackup(): Promise<BottleInfo & { canceled?: boolean }>;
  scanGames(): Promise<Game[]>;
  installSteam(): Promise<BottleInfo>;
  launchSteam(): Promise<{ pid: number }>;
  launchGame(appId: string): Promise<{ pid?: number; canceled?: boolean }>;
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  readLogs(limit?: number): Promise<LogEntry[]>;
  clearLogs(): Promise<LogEntry[]>;
  onEvent(callback: (event: BridgeEvent) => void): () => void;
}

interface Window { steamBridge: SteamBridgeApi }
