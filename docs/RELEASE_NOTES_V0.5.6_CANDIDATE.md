# Pulse v0.5.6 Candidate Notes

状态：未发布候选。本文记录 Draft PR #6–#10 的累计变化，不代表这些改动已经进入 `main`、生成安装包或发布 GitHub Release。

## 主要变化

- 统一 Desktop、Codex 插件、安装命令、Handoff 协议和发布文档的版本契约。
- 在归一化前校验原始快照，强化时区、日期、新鲜度、集合上限和乱码门；客观数据与 AI 洞察可独立降级。
- 缺少主观安全确认、快照较旧、缓存回退或未经认证的自定义 Bridge 时，不提供训练强度；疼痛、胸部症状或头晕继续触发停止训练路径。
- Electron 默认拒绝权限请求，收紧 Preload/CSP，启用 ASAR 完整性与 Fuse，并用原子白名单配置替代宽松写入。
- 深浅主题采用更清晰的对比度与 SVG 图标，恢复键盘焦点和状态播报；透明度只作用于背景层。
- 完整窗口记忆并纠正位置/尺寸；16:9、4:3、21:9 小组件重新调整字号、对齐和留白。
- CI 增加 100%/125%/150% 实窗布局、浅色长文本、依赖变更、工作流固定、SBOM、SHA-256 和构建证明门。

## 仍然存在的限制

- 新 COROS 查询仍必须从获得授权的 Codex 任务触发；桌面按钮只重读本机快照。
- 仅验证 Windows x64；安装包未做 Authenticode 代码签名，也没有自动更新。
- Electron 内存仍高于最初 150 MB 目标。
- 商标清查、应用商店上架、多品牌直连和独立 OAuth 不属于本候选范围。

## 候选验证

本地候选需要通过：

```powershell
npm ci
npm run test:ci
npm run dist:win
npm run test:packaged
```

手动 GitHub Release Candidate 还应产生 installer、blockmap、SPDX SBOM、`SHA256SUMS.txt`、构建来源证明和 SBOM 证明。只有这些产物完成独立核验后，才能另行申请发布授权。
