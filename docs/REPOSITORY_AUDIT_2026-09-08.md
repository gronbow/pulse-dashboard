# Pulse 仓库全面审查与后续开发计划

审查日期：2026-09-08  
审查基线：PR A #12 → PR B #13 → PR C #20；PR D 为本地候选，尚未提交、上传或合并。

## 结论

当前候选没有发现需要停止开发或立即撤回的 P0 问题。隐私边界、训练安全呈现、数据来源标识、Renderer 加载边界和发布供应链已经形成较完整的分层防护。当前最合理的顺序是先完成运行时维护，再单独处理界面信息密度，最后执行跨设备与签名发布门，避免把依赖升级、视觉调整和发布操作混在同一次变更中。

## 本次审查范围

- 数据入口、缓存、Handoff 认证、网络监听和快照覆盖规则。
- Electron 主进程、Preload、Renderer、自定义页面协议、CSP、IPC 来源和权限处理。
- 健康/训练安全呈现、逐项日期与来源、缺失值和演示数据边界。
- Windows 安装包、ASAR、Electron Fuse、图标、工作流、依赖审计、SBOM、校验和与构建证明。
- 深色/浅色完整看板，以及 16:9、4:3、21:9 小组件在 100%、125%、150% 缩放下的布局。
- README、候选说明、需求追踪和发布限制是否与当前实现一致。

## 已确认的安全基础

| 领域 | 当前状态 |
|---|---|
| COROS 凭据 | Desktop 不接收或保存 COROS Token；授权和 MCP 调用保留在 Codex 宿主。 |
| 本机交接 | Handoff 只监听回环地址，使用挑战值、HMAC 和 Bearer Token，限制请求体大小并校验发布内容。 |
| 本地快照 | 使用 Electron `safeStorage` 加密，限制保留数量，并提供清除本地健康数据入口。 |
| Renderer | `sandbox`、`contextIsolation` 开启，`nodeIntegration` 关闭；拒绝权限、外部导航、新窗口和 WebView。 |
| 页面协议 | PR C 只允许 `pulse-app://dashboard` 下五个固定资源，返回 CSP、正确 MIME 和 `nosniff`；IPC 只接受精确入口地址。 |
| 不可信文本 | 活动、标签和动态数据以文本节点写入，不把快照内容作为 HTML 执行。 |
| 训练安全 | 最终 `readiness` 是训练许可类文字的唯一权威；数据不足和停止转介状态不能被设备恢复值或异步 AI 结果覆盖。 |
| 发布边界 | Actions 固定到完整提交，PR 依赖审查、SPDX SBOM、SHA-256、构建证明和 SBOM 证明均已纳入候选流程。 |

## PR D：运行时与发布维护（本地已实现）

1. Electron 从 43.3.0 更新到 44.2.0，`@electron/fuses` 从 1.8.0 更新到 2.1.3，并按新版 ESM 接口调整 Fuse 检查。Electron 官方只支持最新三个主版本，因此应保持独立、可回滚的定期升级节奏。当前项目仅发布 Windows x64，不受 Electron 44 停止 Windows 32 位支持的影响。
2. 开发环境最低 Node.js 改为 22.12.0，与 Electron 44.2.0 和 Fuses 2.1.3 的包级要求一致；安装版用户仍无需自行安装 Node.js。
3. SBOM Action 更新到 0.24.2，并继续以完整提交 SHA 固定。
4. 新增安装包生命周期检查：在临时目录静默安装，启动安装后的应用执行协议、ASAR、CSP 和 MIME 自检，再静默卸载并确认主程序已删除。
5. 锁文件同步纳入 `fast-uri` 3.1.7 与 `@xmldom/xmldom` 0.8.15，因此 PR D 可统一取代当前 Dependabot #11、#16、#17、#18、#19；在 PR D 合并前不关闭这些远程 PR。
6. `npm audit` 的完整锁文件和生产依赖均为 0 个已知漏洞。`electron-builder` 仍带有若干已弃用的传递包，但 26.15.3 已是当前可用版本，本轮不使用危险的强制覆盖替换其内部依赖。

参考：[Electron Releases](https://github.com/electron/electron/releases)、[Electron 版本支持策略](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)、[Electron 44 破坏性变化](https://www.electronjs.org/docs/latest/breaking-changes)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)。

## 页面与体验审查

真实 Electron 截图回归覆盖了完整深色、完整浅色长文本、16:9、4:3 和 21:9 小组件，未发现横向溢出、裁切或本轮升级造成的明显视觉回归。后续仍有三项可改善，但不应混入 PR D：

- 长来源/时效标签在 150% 缩放或窄窗口中容易过早省略，关键状态的可读优先级可以更高。
- 4:3 小组件仍有较多纵向空白，可在不增加信息噪声的前提下重新平衡字号、卡片高度和四项指标间距。
- 设置页层级和“显示哪些卡片”的个性化仍偏弱；应先补卡片显隐，再考虑多语言，避免一次改动范围过大。

建议将这些内容作为 PR E“可读性与卡片密度”，继续使用合成数据截图，并保持完整模式与三个小组件比例的独立回归门。

## 仍需处理的风险与优先级

| 优先级 | 项目 | 处理建议 |
|---|---|---|
| P1 外部发布门 | 安装包没有 Authenticode 签名，SmartScreen 仍可能警告 | 正式稳定版前取得可信证书；此前始终标记为 unsigned beta，并只从 GitHub Release 分发。 |
| P1 外部验证 | 目前主要在一台 Windows 11 设备验证 | 在第二台 Windows x64 设备完成安装、升级、卸载、托盘、任务栏和系统 125%/150% DPI 目视复测。 |
| P1 产品验证 | 连续多日真实 COROS 数据覆盖不足 | 使用真实但不进入仓库的私有快照连续验证健康、活动、计划和七日负荷，记录缺失字段与日期边界。 |
| P2 体验 | 长标签、4:3 密度、卡片显隐 | 按 PR E 单独实现和审查，不与运行时升级耦合。 |
| P2 性能 | Electron 总工作集仍明显高于原 150 MB 目标 | 先用同一采样口径复测 Electron 44；真实闭环稳定后再比较 Electron 调优与轻量桌面壳迁移成本。 |
| P2 维护 | `electron-builder` 的旧传递依赖告警 | 保持 Dependabot 与定期审计；等待上游更新，不使用未经验证的锁文件覆盖。 |

## 推荐开发与合并顺序

1. 依次审查并合并 PR #12、#13、#20。
2. 将 PR D 以 #20 为基线提交为 Draft，经检查通过后审查并合并；随后关闭已被它取代的 Dependabot PR。
3. 从合并后的主线创建 PR E，只处理长标签、4:3 信息密度和卡片显隐。
4. 在干净检出上运行 Release Candidate 工作流，下载并核验安装包、blockmap、SPDX、SHA-256 和两类证明。
5. 完成第二台 Windows 设备验收；发布和版本标签继续使用独立授权。

## PR D 本地验证记录

| 检查 | 结果 |
|---|---|
| `npm run test:ci` | 通过：数据链、隐私、当前分支历史、依赖和真实 Electron UI 回归全部通过。 |
| `npm run pack:win` + `npm run test:packaged` | 通过：自定义协议、ASAR、CSP、MIME、404、托盘、窗口图标和 Fuse。 |
| `npm run dist:win` | 通过：生成 unsigned NSIS x64 安装包与 blockmap。 |
| `npm run test:installer` | 通过：隔离安装、安装版安全自检和卸载生命周期。 |
| 深色/浅色与三种小组件目视检查 | 通过：未发现 Electron 44 引入的布局回归。 |
| `npm run release:checksums`（仅本机） | 按预期失败关闭：本机未运行 GitHub 的 Syft 步骤，因此没有 SPDX 文件；候选工作流会先生成 SBOM，再生成校验和。 |
| Authenticode | 未通过发布门：当前安装包仍为 `NotSigned`，符合 Beta 已知限制，但不能作为正式签名版本发布。 |

本文件记录的是本地候选证据，不代表 PR D 已提交、上传、合并或发布。
