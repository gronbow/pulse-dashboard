# Contributing

欢迎围绕跑步数据、桌面交互和数据可视化提交改进。

- 提交前运行 `npm test`；修改界面后运行 `npm run test:ui` 并检查合成截图；修改工作流或发布流程后运行 `npm run test:workflows` 和 `npm run test:ci`。
- 不要提交个人可穿戴设备数据、FIT 文件、令牌、屏幕截图或本地配置。
- 新增数据字段时，先更新 `docs/BRIDGE_CONTRACT.md`。
- 健康和训练判断应保留数据来源，并避免写成医疗诊断。
- 首次发布新的 Git 历史前，在实际待推送分支上运行 `npm run audit:history`；若失败，使用干净公开分支，不要直接推送含私人标识的旧提交。`npm run audit:history:all` 仅用于诊断全部本地引用。
- 安全漏洞请通过 GitHub Private Vulnerability Reporting 提交，不要在公开 Issue 或 PR 中披露利用细节。
