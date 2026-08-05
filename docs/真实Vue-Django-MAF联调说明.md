# 真实 Vue-Django-MAF 联调说明

`npm run test:e2e` 继续运行 Mock API 页面测试；`npm run test:e2e:integration` 使用独立 Playwright 配置，不使用 `page.route`，由真实 Django、Worker、Fake Provider 和 MAF Workflow 提供数据。

联调使用账号 `e2e / e2e-pass`，后端脚本会创建独立数据库 `newcity/var/frontend-integration.sqlite3`。联调完成后删除该文件即可回滚测试数据，不会清理开发数据库。

前端 CI 会在 Windows Runner 中额外检出后端并执行同一条真实联调命令。自动推送默认使用后端 `agent` 分支；手动触发工作流时可通过 `backend_ref` 指定分支、标签或提交 SHA，以复现固定前后端组合。本地可通过 `NEWCITY_INTEGRATION_BACKEND_ROOT` 指定后端仓库路径。测试使用 Fake Provider，不需要 API Key 或付费模型。

## CI 时限

真实联调单项测试总时限为 180 秒，其中任务创建后的完成状态轮询最多等待 120 秒。该时限用于覆盖 GitHub Windows Runner 的环境波动；超时仍视为失败，不会跳过最终状态、动态任务图、模型审计、Artifact 和页面结果断言。
