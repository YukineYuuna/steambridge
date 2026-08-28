# 兼容性与安全边界

## 状态含义

- **不可用**：已知存在 Wine 无法满足的内核驱动或反作弊要求。SteamBridge 会阻止启动，避免给出错误预期。
- **谨慎**：部分模式可能启动，但在线服务、第三方服务器或更新后的启动器存在明显风险。
- **待验证**：本地规则库没有可靠结论。它不是“兼容”评级，必须以当前引擎和当前游戏版本实测。

因此，SteamBridge 不是把 macOS 变成完整 Windows，也不会让所有 Windows-only 游戏自动可玩。兼容标记只帮助你决定先测试哪些游戏；首次启动前请保存进度并准备好退出、回滚或恢复备份。

规则位于 `electron/lib/compatibility.cjs`。规则应以发行方公开政策和可复现测试为依据，不能把 ProtonDB 的 Linux 结果直接等同于 macOS Wine 结果。

## 热门游戏怎么选

以下名单是“优先测试顺序”，不是官方保证。没有任何一款游戏能在所有 Mac、macOS、Wine/Whisky/CrossOver 版本上保证成功；首次测试前应备份 Steam 空间，并从低画质、单机模式开始。

### 相对适合优先测试

| 游戏 | App ID | 主要不确定性 |
| --- | ---: | --- |
| The Elder Scrolls V: Skyrim Special Edition | 489830 | 启动器、模组和图形插件 |
| Fallout 4 | 377160 | 启动器、大型模组和高清材质 |
| The Witcher 3: Wild Hunt | 292030 | 性能和图形 API |
| Sekiro: Shadows Die Twice | 814380 | 图形 API、手柄和输入 |
| ELDEN RING | 1245620 | 性能、更新和联机策略 |
| Cyberpunk 2077 | 1091500 | 性能、内存和散热 |
| Age of Empires II: Definitive Edition | 813780 | 联机和版本更新 |
| Lethal Company | 1966720 | 联机和 Mod |
| Phasmophobia | 739630 | 麦克风、VR 和多人功能 |

### 需要重点验证

`Grand Theft Auto V`（271590）的故事模式可能比 GTA Online 更容易启动，但 Rockstar 启动器、更新、在线服务和反作弊不保证；`Counter-Strike 2`（730）和 `Dead by Daylight`（381210）也可能只能运行部分模式。

### 已知限制或不建议尝试

`Apex Legends`（1172470）、`Destiny 2`（1085660）、`Rust`（252490）、`Tom Clancy's Rainbow Six Siege`（359550）、`PUBG: BATTLEGROUNDS`（578080）、`Halo Infinite`（1240440）和 `Lost Ark`（1599340）依赖当前不支持 Wine 的反作弊或驱动策略。SteamBridge 会阻止或标记它们，不应通过补丁、替换 DLL 或修改器绕过。

## 不能解决的问题

SteamBridge 是用户态兼容启动器，不是 Windows 内核，也不是虚拟机。因此以下功能通常不可用：

- Windows 内核驱动、文件系统过滤驱动和硬件厂商专用驱动
- Riot Vanguard 一类要求 Windows 内核完整性的反作弊
- 未由发行方开启 Wine/Proton 支持的 BattlEye 或 Easy Anti-Cheat
- 要求特定 Windows 安全功能、商店服务或 UWP 环境的游戏
- 明确禁止兼容层的在线服务

不要尝试修改、禁用或隐藏反作弊组件。即使技术上能够进入游戏，也可能触发帐号处罚。

## 引擎说明

- **WhiskyWine**：免费，但 Whisky 项目已停止维护，未来 macOS 或游戏更新可能造成退化。
- **Homebrew Wine**：适合通用 Windows 应用，游戏图形 API 支持取决于具体构建。
- **CrossOver Wine**：商业引擎，通常提供更完整的 macOS 游戏转换组件，但仍不保证单个游戏可用。
- **自定义引擎**：SteamBridge 只验证可执行文件存在且可执行；来源、补丁、许可和安全性由用户确认。

一个引擎创建的 Bottle 不一定能安全地由另一个引擎继续使用。切换前应备份存档；云存档同步状态也应在 Steam 中确认。

## 日志与隐私

日志记录 SteamBridge 自身操作、子进程标准输出/错误和 PID，用于诊断。日志不会主动上传。Wine 或 Steam 输出可能包含本机路径、Steam 用户名或其他环境信息；提交问题前应先检查并删去个人信息。
