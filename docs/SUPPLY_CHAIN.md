# Pulse 供应链与发布产物

## 当前边界

Pulse v0.5.6 仍是未签名 Windows Beta 候选。GitHub Actions 的构建证明可以确认产物来自哪个仓库、提交和工作流，但不能替代 Windows Authenticode 代码签名，也不能消除 SmartScreen 提示。

截至 2026-09-08，仓库已启用 GitHub Vulnerability Alerts、Dependabot Security Updates、Secret Scanning、Push Protection 和 Private Vulnerability Reporting。`main` 要求经 Pull Request 合并、`test` 状态通过并解决讨论；管理员同样受保护规则约束，强推和删除均被禁止。

候选分支还加入 `.github/dependabot.yml`：每周检查 npm 与 GitHub Actions 更新。该配置只有合并到默认分支后才会开始创建版本更新 PR；安全更新已经由仓库设置启用。

## CI 与 Release Candidate

- 普通 PR 在 Windows 上执行 `npm run test:ci`，并单独运行高危依赖变更审查。
- 所有第三方 Action 使用 40 位提交 SHA 固定，旁边保留可读版本注释；Dependabot 负责提出后续更新 PR。
- Release Candidate 只允许人工触发，不自动创建 Tag、GitHub Release 或公开安装包。
- 工作流先跑完整测试，再构建 unsigned NSIS x64 安装包并验证打包图标、Electron Fuse，以及隔离安装—安装版安全自检—卸载的完整生命周期。
- Anchore Syft 扫描 `release/win-unpacked`，输出 SPDX JSON；随后生成安装包、blockmap 与 SBOM 的 `SHA256SUMS.txt`。
- GitHub 为安装包分别生成构建来源证明和 SPDX SBOM 证明。

PR D 本地候选使用 Electron 44.2.0、`@electron/fuses` 2.1.3、Node.js 22.12+ 和 Anchore SBOM Action 0.24.2。锁文件与两类 npm 审计均为 0 个已知漏洞；这些版本在 PR D 合并前不代表默认分支状态。

预期下载包包含：

| 文件 | 用途 |
| --- | --- |
| `Pulse-Dashboard-Setup-<version>-x64.exe` | 未签名 Windows 测试安装包 |
| `Pulse-Dashboard-Setup-<version>-x64.exe.blockmap` | electron-builder 差分元数据；当前尚未启用自动更新 |
| `pulse-dashboard-windows-x64.spdx.json` | 打包目录的 SPDX 软件物料清单 |
| `SHA256SUMS.txt` | 上述产物的 SHA-256 校验值 |

## 用户核验

下载后可在 PowerShell 中核对安装包：

```powershell
Get-FileHash .\Pulse-Dashboard-Setup-0.5.6-x64.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

手动候选工作流实际运行并生成证明后，可使用 GitHub CLI 验证构建来源：

```powershell
gh attestation verify .\Pulse-Dashboard-Setup-0.5.6-x64.exe --repo gronbow/pulse-dashboard
gh attestation verify .\Pulse-Dashboard-Setup-0.5.6-x64.exe --repo gronbow/pulse-dashboard --predicate-type https://spdx.dev/Document/v2.3
```

Draft PR 中只有工作流定义，不代表证明已经生成；只有 GitHub Actions 对具体提交构建出的安装包才具有对应证明。

## 发布门

1. 按堆叠顺序审查并合并候选 PR。
2. 在目标远程提交的干净检出中通过 `npm ci`、`npm run test:ci`、`npm run dist:win`、`npm run test:packaged` 与 `npm run test:installer`。
3. 人工运行 Windows Release Candidate 工作流并下载全部产物。
4. 核对 SHA-256、SPDX 文件和两类证明，并完成安装/升级/卸载与实际 DPI 目视复测。
5. 未获得可信代码签名证书前，继续将安装包标记为 unsigned beta；合并授权不等于发布授权。
