# Pulse 版本兼容性

Pulse Desktop 与 Codex 插件通过本机 Handoff 协议协作。两端必须来自同一发布版本；不要把已发布的桌面安装包与 `main` 分支插件混用。

| 状态 | Desktop | Codex 插件引用 | Handoff 协议 | 说明 |
| --- | --- | --- | --- | --- |
| 已发布 | v0.5.5 | `v0.5.5-beta` | v1 | 当前 GitHub Pre-release 的成对安装组合。 |
| 开发候选 | v0.5.6 | `v0.5.6-beta`（尚未发布） | v2 | 当前源码；只有相应 Release 创建后才可按此标签安装。 |

## 安装规则

1. 从 GitHub Release 下载某一版本的 Desktop 安装包。
2. 使用同一 Release 对应的插件标签，不使用 `main` 作为公开安装来源。
3. 更新时同时更新 Desktop 与插件，并新建 Codex 任务以重新加载插件。
4. 如果两端版本不匹配，先恢复为上表中的完整组合，不通过关闭认证或跳过校验来兼容。

机器可读版本见 [`release-compatibility.json`](release-compatibility.json)。仓库通过 `npm run test:release-contract` 检查 Desktop、根插件包、公开插件包和 Handoff 协议是否同步。维护者可用 `npm run version:set -- <version>` 在一次事务中更新三个版本清单和候选兼容记录。
