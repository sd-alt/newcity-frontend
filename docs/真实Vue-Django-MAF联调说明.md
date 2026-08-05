# 真实 Vue-Django-MAF 联调说明

`npm run test:e2e` 继续运行 Mock API 页面测试；`npm run test:e2e:integration` 使用独立 Playwright 配置，不使用 `page.route`，由真实 Django、Worker、Fake Provider 和 MAF Workflow 提供数据。

联调使用账号 `e2e / e2e-pass`，后端脚本会创建独立数据库 `newcity/var/frontend-integration.sqlite3`。联调完成后删除该文件即可回滚测试数据，不会清理开发数据库。

前端 CI 会在 Windows Runner 中额外检出后端并执行同一条真实联调命令。自动推送默认读取 `.github/backend-agent.sha`，始终使用已经验证的后端完整提交 SHA；后端 `agent` 分支继续更新不会改变旧前端提交的重跑结果。手动触发工作流时仍可通过 `backend_ref` 指定分支、标签或其他提交 SHA。本地可通过 `NEWCITY_INTEGRATION_BACKEND_ROOT` 指定后端仓库路径。测试使用 Fake Provider，不需要 API Key 或付费模型。

工作流摘要会记录前端 SHA、实际后端引用、图 Schema、Planning/Execution Prompt 版本和数据库迁移版本。当前默认兼容组合为：后端 `bfd94853380fba446ad33cbd32a466288e3b1f37`、`task-graph-schema-v2`、`newcity-planning-v0.2`、`newcity-execution-v0.2`、`operations.0046`；前端版本以触发工作流的 `GITHUB_SHA` 为准。

真实联调包含两条浏览器链路：一条验证资源查询动态图、模型调用审计和最终结果；另一条验证完整规划经过指标确认、方案确认、下发确认后，继续执行监控、成果汇集和任务完成。两条链路都调用真实 Vue、Django API、Worker、Fake Provider 和 MAF，不使用接口 Mock。

## CI 时限

资源查询用例沿用全局 180 秒时限；完整规划用例因包含三次人工确认，单项总时限为 300 秒，其中每个人工节点最多等待 90 秒、最终完成状态最多等待 120 秒。该时限用于覆盖 GitHub Windows Runner 的环境波动；超时仍视为失败，不会跳过最终状态、动态任务图、Checkpoint、模型审计、Artifact 和页面结果断言。
