# Agent 人工节点与助手入口说明

Agent 工作流进入 `waiting_input` 或 `waiting_approval` 时，任务不会结束，而是保存当前节点、人工请求和 MAF checkpoint，等待用户处理。

右下角 AI 助手会定期读取当前登录用户的待处理 Agent 运行，并在对话区显示任务卡片：

- `waiting_input` 显示“补充信息”，用于补充区域、时间、目标或约束；
- `waiting_approval` 显示“查看并确认”，用于查看指标、方案或下发请求；
- 点击卡片后进入 `/application/tasks?runId=<runId>`，任务工作区会加载该运行并自动定位到人工处理区域。

补充信息通过 Agent 消息接口提交，人工确认通过审批接口提交。两者提交后都会把运行重新放入队列，由 `run_agent_worker` 从 checkpoint 继续；助手不会绕过人工确认直接执行高风险节点。

助手的“创建任务”操作现在统一创建 AgentRun，返回 `runId`，再由对话中的“打开任务运行”按钮进入 `/application/tasks?runId=<runId>`。动态模式处于规划队列时不会提前生成任务草稿；只有任务图运行到正式任务建立节点后才会出现任务记录。

任务运行页面会展示规划状态、执行状态、当前节点、人工请求和补充入口。`waiting_input` 时用户可以在助手卡片点击“补充信息”，提交后 Worker 从规划或执行 Checkpoint 继续；不需要用户手动刷新阶段或重新创建任务。

本地验证至少需要同时运行 Django 服务、Vite 开发服务和 Agent Worker。若助手没有待办卡片，先检查当前登录用户是否拥有 `waiting_input` 或 `waiting_approval` 状态的 Agent 运行。
## 规划图与执行图

任务运行接口同时返回 `planningWorkflow` 和 `executionWorkflow`。页面的 Planning Workflow 固定展示“需求理解 → 任务分类 → 图规划 → 图校验”四个真实规划节点，下面的 Workflow 概览展示已经校验并编译后的执行图；`workflow` 仅作为旧客户端兼容字段。

页面会显示实际的 `fixed-maf`、`template-maf` 或 `dynamic-maf` 模式及其来源。`dynamic-maf` 在 `planning_queued` 或 `planning` 阶段不会伪装成已经开始执行，规划完成后才进入独立的 Execution Workflow。

执行监控出现未完成执行项时，运行会显示排队/等待状态；出现执行失败或人工介入时，助手会显示对应的“处理执行异常”入口。用户提交处理意见后，运行会重新入队并从保存的 Checkpoint 继续。

前端 E2E 使用 Playwright 验证同一 AgentRun 同时展示两张工作流图、四个规划节点、实际 MAF 来源和执行终点。开发机若已安装 Chrome，可直接执行 `npm run test:e2e`；CI 会安装 Playwright Chromium 后执行同一脚本。
