# Progress

## 2026-07-28 - Task: 按完整方案改造四中心与智能任务规划前端

### What was done
- 将一级导航、首页功能目录和全局搜索统一为任务、资源、业务、应用四中心，旧六中心 URL 仅保留重定向兼容，不再重复建设入口。
- 新增任务中心手工指标建模与任务指标体系、传感器八元组、知识库、执行成果、应用中心三模式 Agent 工作区，并保留 Cesium 地图公共工作区。
- 手动模式支持地图多边形 WKT、立即任务草案、跳转并绑定任务指标；AI/多 Agent 模式展示阶段轨迹、人工确认、工具来源、工件、补充信息和暂停/恢复/重试/取消/接管。
- 按地学作业台方向使用岩层灰、测绘青和预警琥珀，流程轨迹作为唯一强视觉元素；补齐加载、空数据、错误、校验、反馈、搜索、分页与确认交互。
- 新增前端路由、页面与运行说明，并把既有资源、数据、规划、算法、应用页面接入四中心规范路径。

### Testing
- `npm.cmd run typecheck`：通过，无 TypeScript/Vue 类型错误。
- `npm.cmd run build`：通过，Vite 7.3.6 成功转换 80 个模块并生成生产包。
- 规范路径静态核对：功能目录和全局搜索不再输出 `/indicators`、`/data`、`/planning`、`/algorithms`、`/applications` 旧路径；`AppLayout` 仅定义任务、资源、业务、应用四个一级中心。
- Chrome/Playwright 本地真实浏览器验收：使用演示账号登录后，一级入口精确为“任务中心、资源中心、业务中心、应用中心”；应用任务页显示“手动创建、AI辅助、多Agent自动规划”和地图绘制入口，页面无横向溢出、无运行时 `pageerror`。截图位于系统临时目录，未写入仓库。
- `git diff --check`：通过，无空白错误。

### Notes
- 改动文件：
  - `src/router/index.ts`：建立四中心规范路由与旧路径重定向。
  - `src/components/AppLayout.vue`：将顶部和左侧导航收敛为四中心，并统一搜索、详情跳转与地图对象定位路径。
  - `src/features/catalog.ts`：用四中心功能清单替换旧六中心目录。
  - `src/pages/HomeView.vue`：新增四中心业务入口与职责说明。
  - `src/api/endpoints.ts`：增加四中心模型、业务动作与 Agent 运行 API。
  - `src/gis/mapShell.ts`：让四中心新路径复用既有 Cesium 图层模式。
  - `src/pages/TaskCenterView.vue`：实现基础指标、六层建模、任务指标绑定/确认与版本追溯。
  - `src/pages/SensorMetadataView.vue`：实现传感器八元组统一详情、编辑和敏感凭据隔离。
  - `src/pages/ResourceKnowledgeView.vue`：实现知识检索、分页和维护。
  - `src/pages/BusinessExecutionView.vue`：实现执行进度、模拟推进、成果汇集与查看。
  - `src/pages/AgentTaskWorkspace.vue`：实现手动、AI 辅助、多 Agent 任务入口与运行轨迹工作区。
  - `src/pages/ResourcesCenter.vue`、`DataCenter.vue`、`PlanningCenter.vue`、`AlgorithmsCenter.vue`、`ApplicationsCenter.vue`：将既有页面的地图刷新与内部跳转改为当前四中心路径。
  - `docs/四中心与智能任务规划前端说明.md`：记录入口、路由、三模式流程、视觉约束和验证命令。
  - `progress.md`：新增并记录本轮实施、验证与回滚点。
- 回滚方式：本仓库本轮改动均未提交；确认需要整体回滚后，可对上述已跟踪文件执行 `git restore -- <文件>`，再删除本轮新增的五个 Vue 页面、`docs/四中心与智能任务规划前端说明.md` 和 `progress.md`。回滚前建议先用 `git diff > four-center-frontend.patch` 保存补丁。
