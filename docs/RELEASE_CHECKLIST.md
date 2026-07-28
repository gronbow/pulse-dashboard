# Pulse 测试版发布检查清单

## 本地质量门

- [ ] `npm ci` 能从锁文件安装依赖。
- [ ] `npm test` 全部通过。
- [ ] `npm run audit:production` 通过；只打包的运行时依赖不得有已知高危漏洞。
- [ ] `npm run test:desktop` 生成真实 Electron 窗口截图，标题栏、圆角卡片和内置滚动条无回归。
- [ ] `npm run test:tray` 与 `npm run test:window-icon` 在开发态通过。
- [ ] 构建后运行 `npm run test:packaged`，确认解包版随包图标、托盘、窗口身份与 `AppUserModelID`。
- [ ] `npm run test:secondary-health` 断言压力卡片与旧快照血氧回退。
- [ ] `npm run test:unavailable` 断言无真实快照/同源缓存时不显示任何 Demo 健康数值。
- [ ] 系统托盘与任务栏人工显示 Pulse 标志，而不是空白占位框或 Electron 默认原子图标。
- [ ] `npm run pack:win` 成功，解包目录中只含桌面运行所需文件。
- [ ] `npm run dist:win` 成功生成 Windows x64 测试安装包。
- [ ] 安装包为测试用途；未完成代码签名时明确提示 Windows 可能显示未知发布者警告。

当前完整 `npm audit` 会报告 electron-builder 构建工具链中的 `brace-expansion` 高危拒绝服务公告；这些包只存在于 `devDependencies`，不会进入 `app.asar`，而生产依赖审计为 0。不要使用会把 electron-builder 强制降级的 `npm audit fix --force`；应等待上游兼容更新后再复核。

最终 v0.5.4 解包版在当前 Windows 机器的 5 秒采样中约占 0.31% 单核（整机约 0.022%），但 Electron 四进程总工作集约为 404 MB，高于原始 150 MB 目标。测试版发布说明必须披露该差距，不能宣称已达到轻量内存指标。

## 数据与隐私门

- [ ] `npm run audit:public` 通过。
- [ ] Git 未跟踪 `.fit`、训练计划、真实快照、坐标、活动 ID、令牌、日志或本地截图。
- [ ] 打包白名单只包含 `src`、Codex Handoff、`package.json` 和 `LICENSE`。
- [ ] 演示快照为合成数据。
- [ ] README 预览图来自合成演示数据，不包含桌面背景或真实健康信息。
- [ ] 在实际待推送分支上运行 `npm run audit:history` 并通过。

`npm run audit:history` 仅检查当前 `HEAD` 可到达的提交；`npm run audit:history:all` 检查全部本地引用。当前开发分支的旧提交曾包含个人 Windows 路径和原始活动标识，因此全引用诊断可能预期失败。首次推送 GitHub 前，应从已验证工作树创建干净的公开历史，并保留原开发分支作为本地备份。不要直接推送现有旧历史或任何包含私人记录的引用。

## 功能验收

- [ ] Pulse 使用 Codex + COROS MCP 数据源启动。
- [ ] 插件至少取得两个有效健康信号。
- [ ] 有距离的训练同时具有正时长。
- [ ] 中文运动名称和洞察无乱码。
- [ ] 插件发布后桌面窗口自动更新。
- [ ] 缺失或损坏快照被拒绝，旧完整快照仍可读取。
- [ ] Codex 首次同步前显示等待状态；跨 provider 缓存不混用，Demo 只在主动选择演示源时出现。
- [ ] 旧日期明确标记为“快照较旧”，不冒充今日数据。
- [ ] 单项指标使用自己的 `date`；凌晨尚未归档时，最近有效值显示其真实日期。
- [ ] “近 7 日状态”包含七个逐日训练负荷点，缺失时显示明确占位而不是空白图表。
- [ ] Windows 托盘图标在 100% 与当前系统缩放比例下清晰可辨。
- [ ] Windows 任务栏按钮使用 Pulse 图标，窗口分组的 `AppUserModelID` 为 `app.pulse.dashboard`。

## GitHub 前的人工确认

- [ ] 用户确认仓库名称、可见性和 GitHub 账号。
- [ ] 用户确认允许创建远程仓库并上传干净公开分支。
- [ ] CI、Issue 模板、PR 隐私检查和手动 Windows Release Candidate 工作流存在。
- [ ] 上传后再次检查默认分支、Release 资产和仓库文件，不发布本地健康数据。
