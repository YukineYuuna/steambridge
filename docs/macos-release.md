# macOS 打包、签名与安装验收

Windows 不能生成可被 Gatekeeper 信任的 macOS 签名，也不能代替公证和 DMG 安装测试。仓库提供两个 GitHub Actions 工作流：

- `Package macOS`：手动触发，生成 ARM64 和 x64 的未签名 DMG/ZIP，并检查 Mach-O 架构、DMG 挂载和 ZIP 解压。
- `Release macOS`：推送 `v*` 标签触发，要求签名和公证 Secrets，完成签名、公证票据、Gatekeeper 和安装副本验收后才发布。

## 发布前准备

在 GitHub 仓库的 Actions Secrets 中配置：

`MACOS_CERTIFICATE_BASE64`、`MACOS_CERTIFICATE_PASSWORD`、`MACOS_KEYCHAIN_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

证书必须是 Apple Developer ID Application，Team ID 必须与证书和 Apple ID 所属团队一致。应用专用密码不能使用 Apple ID 主密码。Secrets 只保存在 GitHub，不要写入仓库或日志。

## 手动本地构建（真实 Mac）

```bash
npm ci
npm run check
npm run build:mac -- --arm64
npm run build:mac -- --x64
```

产物在 `release/`。未签名产物只适合个人测试，首次打开可能触发 Gatekeeper 警告；不要把它当作正式发行版。

## 发布验收内容

工作流会对每个架构检查：

1. `.app` 主程序的 `lipo -info` 与目标架构一致。
2. `codesign --verify --deep --strict`、Developer ID Authority 和 TeamIdentifier。
3. `spctl --assess` 和 `stapler validate`。
4. 挂载 DMG，把 `.app` 复制到临时安装目录后再次验证。
5. 解压 ZIP 后再次验证签名和 Gatekeeper。

只有 `Release macOS` 的 ARM64 与 x64 两个 job 都成功，且 GitHub Artifact/Release 中的 DMG、ZIP 和 `SHA256SUMS.txt` 均可下载，才算完成双架构发布。SteamBridge 本身仍不能保证每一款 Windows 游戏兼容；签名只证明应用来自指定开发者，不代表 Wine、Steam 或游戏受 Apple/Valve 支持。
