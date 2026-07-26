# Contributing

欢迎围绕跑步数据、桌面交互和数据可视化提交改进。

- 提交前运行 `npm test`；修改界面后再运行 `npm run test:desktop` 并检查截图。
- 不要提交个人可穿戴设备数据、FIT 文件、令牌、屏幕截图或本地配置。
- 新增数据字段时，先更新 `docs/BRIDGE_CONTRACT.md`。
- 健康和训练判断应保留数据来源，并避免写成医疗诊断。
- 首次发布新的 Git 历史前，在实际待推送分支上运行 `npm run audit:history`；若失败，使用干净公开分支，不要直接推送含私人标识的旧提交。`npm run audit:history:all` 仅用于诊断全部本地引用。
