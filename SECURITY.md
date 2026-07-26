# Security policy

请不要在 GitHub issue、截图或日志中提交：

- 数据源账号密码、OAuth client secret、access token 或 refresh token
- 未脱敏的活动 FIT 文件、地理坐标、活动 ID 或个人资料
- 包含真实健康数据的日志和 API 响应

如果发现安全问题，请先私下联系仓库维护者，不要公开发布令牌或可识别的健康数据。

本项目当前是个人实验项目，不提供医疗用途或安全性保证。部署桥接服务时应自行完成依赖、权限、日志和网络暴露审查。

Pulse 内置 Handoff 只监听回环地址，并拒绝带浏览器 `Origin` 的写入和非 JSON 快照。自定义 Bridge 也被限制为 `localhost` / `127.0.0.1`，避免把健康快照误发到远程地址。

公开前请运行：

```powershell
npm run audit:public
npm run audit:history
npm run audit:history:all
```

第一项检查当前工作树；第二项检查当前待推送 `HEAD` 可到达的历史；第三项诊断全部本地引用。删除当前文件不能自动清除历史中的私人内容，也不要推送未通过分支审计的引用。
