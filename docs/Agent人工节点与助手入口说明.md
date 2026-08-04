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
