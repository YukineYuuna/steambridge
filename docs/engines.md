# 兼容工具安装说明

SteamBridge 本身不包含 Wine，也不会自动执行网上找到的命令。请只从下面的官方页面下载，安装完成后回到 SteamBridge，在“更多设置”选择兼容工具可执行文件。

## 先判断你的 Mac

- Apple 芯片（M1/M2/M3/M4）可能需要 Rosetta 2。系统弹窗要求安装时按 Apple 提示操作；不要下载第三方“Rosetta 安装包”。
- Intel Mac 不需要 Rosetta 2，但仍需要一个 Wine 兼容工具。

## 选择一个工具

### CrossOver

适合不想折腾的用户，软件付费并提供商业支持。打开 [CodeWeavers CrossOver](https://www.codeweavers.com/crossover)，安装后启动一次，再在 SteamBridge 选择 CrossOver 提供的 Wine 可执行文件。

### Homebrew Wine

适合愿意按命令行官方文档操作的用户。先阅读 [Homebrew 官网](https://brew.sh) 当前的安装说明，再按 Wine 项目的最新文档安装。不要直接复制陌生网页的一键脚本。安装后选择实际存在且可执行的 `wine` 文件；SteamBridge 会检查同目录是否有 `wineboot`。

### Whisky

Whisky 曾提供简单的图形界面，但项目目前已停止积极维护。已有安装可以继续尝试，新用户应先评估仍在维护的方案。只从 [Whisky 官网](https://getwhisky.app) 获取安装包，不要安装所谓“优化版”或破解包。

## 安装完成后的操作

1. 打开兼容工具一次，完成它自己的首次设置。
2. 回到 SteamBridge，打开“更多设置”或新手教程第 2 步，点击“选择兼容工具”。
3. 选择官方安装产生的可执行文件，等待 SteamBridge 重新检测。
4. 再创建 Steam 专用空间。不要把 Bottle 放到包含密码、密钥或重要工作文件的目录。

SteamBridge 只检查文件是否存在、可执行以及能否找到 `wineboot`，无法证明第三方引擎没有恶意代码。Wine 游戏仍以你的 macOS 用户权限运行，不是虚拟机或 macOS 沙箱。
