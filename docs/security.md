# SteamBridge 安全说明

这份说明描述当前版本的保护、使用时仍然存在的风险，以及发布者必须完成的 macOS 安全步骤。它不是对第三方 Wine 引擎、Steam 或游戏二进制文件的安全保证。

## 已启用的默认保护

### 渲染进程和 IPC

- Electron 使用上下文隔离、sandbox、`nodeIntegration: false`、`nodeIntegrationInWorker: false` 和 `webSecurity`。
- 渲染进程只能调用预加载脚本暴露的固定 IPC 方法；主进程验证请求来自唯一主窗口的 main frame。
- 禁止 `window.open`、`webview` 和页面导航；生产包只接受 `file:` 资源，开发模式只接受 `127.0.0.1:5173`。
- 默认拒绝摄像头、麦克风、地理位置等权限。
- `shell.openPath` 只允许当前 Bottle 或日志目录；符号链接会解析后再次验证，防止跳出边界。
- 外部链接只允许 HTTPS 的 Apple、Homebrew、WineHQ、Whisky 和 CodeWeavers 官方主机。

这些措施保护的是 SteamBridge 界面，不会把 Wine 游戏变成可信代码。

### Wine 子进程和 Bottle

- Bottle 目录创建为用户私有权限（`0700`，文件为 `0600`）。
- 创建、扫描、安装和启动前都会重新解析真实路径，并拒绝磁盘根目录、用户主目录和非 Bottle 目录。
- Wine 默认的 `Z:` 到 macOS 根目录映射会被移除。破损或非符号链接的映射不会被静默覆盖，而是让操作失败。
- Wine 的 `HOME`、`TMPDIR`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 和 `XDG_DATA_HOME` 指向 Bottle 内专用目录。
- 子进程不会继承任意环境变量；可能包含 API 密钥的环境变量不会传入 Wine。平台探测执行用户选择的引擎时也使用同一白名单。
- Bottle 运行时目录、`dosdevices`、`drive_c` 和 Steam 可执行文件会检查真实路径；目录层级中的符号链接不能跳出 Bottle，受管理的新 Bottle 也不能通过同名链接写到外部目录。
- Steam/游戏启动前和运行期间会每约 100 毫秒检查 Bottle 安全状态。若发现 `Z:` 主机根目录映射、运行目录被替换，或（在 macOS 上）Bottle 对其他用户开放，SteamBridge 会立即终止 Wine 进程组、写入高优先级日志并弹出“安全停止”警告。
- 运行器不使用 shell 拼接命令；安全检查异常会以 `STEAMBRIDGE_SAFETY_STOP` 失败，后续操作被操作锁阻止，直到用户修复路径并重新检测。
- 新建 Bottle 时会先把 Wine 的 `C:`/`Z:` 映射指向 Bottle 内部，`wineboot` 初始化期间也会监视映射；初始化完成后会移除 `Z:`。如果兼容引擎把它改回主机路径，初始化会立即停止。
- Steam VDF 中的 `Z:` 路径、外部驱动路径和指向 Bottle 外的符号链接默认不参与扫描。

移除 `Z:` 会牺牲部分“访问 Mac 文件”的便利性，这是保护主机文件的有意取舍。需要共享文件时，应复制到 Bottle 内部，或明确评估风险后手动配置独立的非敏感目录。

### 下载和执行

- Steam 安装器只从 `https://cdn.akamai.steamstatic.com` 下载，最多跟随 3 次同域 HTTPS 重定向。
- 下载有 16 MiB 大小上限、临时文件原子重命名、PE/DOS 结构检查和 SHA-256 检查。
- Wine/安装器子进程的标准输出和错误输出各限制为 4 MiB，避免异常程序用无限输出耗尽 SteamBridge 内存；实时日志仍会按长度和文件大小限制保存。
- 当前版本固定校验官方 `SteamSetup.exe` 的大小和 SHA-256。Valve 更新安装器后，SteamBridge 会拒绝执行，必须先更新应用中的固定值；不要为了“能安装”而关闭校验。
- Wine、CrossOver、Whisky 和自定义引擎由用户提供。SteamBridge 只检查可执行文件和 `wineboot` 是否存在，无法证明引擎来源可信。

### Steam 空间备份

- “备份当前空间”会把当前 Bottle 中的 Steam、游戏、存档和配置复制到 Electron `userData/backups`，备份目录和文件默认只允许当前用户访问。
- 复制前会检查每个符号链接；指向 Steam 空间外部的链接会让备份失败，空间内用于 Wine 的相对链接会原样保留。
- 恢复、导入和迁移只会创建新的 Steam 空间，绝不覆盖当前空间或已有备份；目标已存在时操作会停止。
- 备份不会加密，也不是防篡改证据。拿到备份文件的人可能读取 Steam 会话、存档和配置；请把备份放在加密磁盘或受保护的外置介质上。
- 备份整个游戏库可能非常大。切换引擎前应先退出 Steam，等待云存档同步完成，再创建备份；恢复后首次启动可能触发 Steam 或游戏重新验证。

### 反作弊和游戏风险信号

扫描会在有限深度和文件数内查找 EAC、BattlEye、Vanguard 和常见内核驱动标记。命中内核驱动或 Vanguard 会阻止启动；命中 EAC/BattlEye 会在启动前显示风险确认。目录扫描是启发式的，不是反病毒软件，也不能识别重命名或内存加载的组件。

## 仍然无法消除的风险

Wine 程序仍以当前 macOS 用户权限运行。恶意游戏、破解补丁、修改器、陌生 DLL 或恶意引擎可能：

- 读取、修改或加密当前用户可访问的文件和已挂载磁盘
- 读取 Bottle 内 Steam 会话、存档和配置
- 通过网络发送数据，或诱导用户输入 Steam 凭据
- 利用 Wine、图形驱动或 macOS 漏洞提升影响范围

SteamBridge 不提供虚拟机级隔离、网络隔离、反病毒扫描或账号安全保证。Steam Guard、DRM、游戏封禁和发行方政策仍然有效。不要尝试禁用或绕过反作弊。

安全监视器只能看到 SteamBridge 管理的 Bottle 路径和它启动的进程。它不能拦截 Wine 内部的每一次系统调用，也不能保证恶意引擎不会自行脱离进程组、利用 Wine/macOS 漏洞或通过网络造成损害。因此，发现可疑引擎、补丁或游戏时应先停止操作并删除/隔离它，而不是依赖监视器“兜底”。

日志会脱敏用户主目录、Bearer token 和常见密码字段，并限制单条长度和日志总大小；但 Wine/Steam 输出可能仍包含账号、路径或游戏内容。分享日志前必须人工检查。

## 建议的最低安全配置

1. 使用单独的标准 macOS 用户测试，不要使用管理员日常账号。
2. 不给 SteamBridge、Wine 或任何游戏授予“完全磁盘访问权限”。
3. Bottle 放在专用磁盘目录，不要放在 `~/Documents`、密码管理器目录或备份敏感资料的目录旁。
4. 只使用 WineHQ、Homebrew、CodeWeavers 或项目官方发布的引擎。
5. 只运行正版游戏和可信的游戏文件；不要安装来源不明的 DLL、修改器或破解补丁。
6. 开启 FileVault、系统防火墙和 Time Machine/离线备份；重要存档先手动备份。
7. 首次运行联网游戏时使用 Steam Guard，并准备好撤销登录会话。
8. 遇到要求关闭 Gatekeeper、SIP、防火墙或反病毒保护的教程时停止操作。

## macOS 发布安全

开发构建可以未签名运行，但公开分发必须：

- 使用 Apple Developer ID Application 证书签名
- 启用 Hardened Runtime（项目已默认开启）
- 在 CI 中使用短期密钥链导入证书，不把证书或密码提交到仓库
- 使用 Apple notarization，并在产物上运行 `codesign --verify --deep --strict` 与 `spctl --assess`
- 发布 DMG/ZIP 的 SHA-256 清单，并通过可信发布渠道分发

`.github/workflows/release-macos.yml` 只在配置所需 GitHub Secrets 后执行签名和公证，并且 `codesign`/`spctl` 检查失败会阻止发布。`package-macos.yml` 需要手动触发，只生成用于测试的未签名产物；用户必须看懂 Gatekeeper 警告，不要把未签名文件冒充正式发行版。

发布工作流还会检查 ARM64/x64 Mach-O 架构、公证票据，并挂载 DMG、解压 ZIP 后再次验证。Windows 开发机无法执行这些 macOS 检查；必须在 GitHub macOS runner 或真实 Mac 上看到工作流成功，才能声称完成签名、公证和安装验收。
