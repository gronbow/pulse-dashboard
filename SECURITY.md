# Security policy

请不要在 GitHub issue、截图或日志中提交：

- 数据源账号密码、OAuth client secret、access token 或 refresh token
- 未脱敏的活动 FIT 文件、地理坐标、活动 ID 或个人资料
- 包含真实健康数据的日志和 API 响应

仓库当前尚未配置公开的私人安全联系渠道。若发现安全问题，请创建不含利用细节、令牌、路径或健康数据的最小公开 Issue，请求维护者建立私下联系；在私密渠道建立前不要提交敏感证明材料。未来启用 GitHub Private Vulnerability Reporting 后，应优先使用该入口。

本项目当前是个人实验项目，不提供医疗用途或安全性保证。部署桥接服务时应自行完成依赖、权限、日志和网络暴露审查。

Pulse 内置 Handoff 只监听回环地址，使用随机挑战/HMAC 确认服务身份，以当前用户随机令牌保护 API，并拒绝带浏览器 `Origin` 的写入和非 JSON 快照。桌面快照使用 Windows 当前用户的系统加密能力保存；自定义 Bridge 也被限制为 `localhost` / `127.0.0.1`，避免把健康快照误发到远程地址。完整边界见 [本地威胁模型](docs/THREAT_MODEL.md) 与 [隐私说明](docs/PRIVACY.md)。

公开前请运行：

```powershell
npm run audit:public
npm run audit:history
npm run audit:history:all
```

第一项检查当前工作树；第二项检查当前待推送 `HEAD` 可到达的历史；第三项诊断全部本地引用。删除当前文件不能自动清除历史中的私人内容，也不要推送未通过分支审计的引用。
