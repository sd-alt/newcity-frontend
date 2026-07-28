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

## 2026-07-28 - Task: 展示多指标共同覆盖与传感资源协同关系

### What was done
- 在现有规划工作台第 8 步内增加多指标共同覆盖、总体并集覆盖、覆盖错位和指标满足情况，不新增一级中心或重复页面。
- 增加“共同覆盖—覆盖错位—未覆盖”空间比例带，并展示竞争、互补、增强、协作关系数量、资源组合与计算依据。
- 多指标评估完成后，Cesium 地图优先绘制共同覆盖和共同缺口；单指标任务保持原有覆盖展示行为。
- 保留完整计算证据入口并继续过滤内部 WKT 字段，更新四中心前端说明。

### Testing
- `npm.cmd run typecheck`：通过，无 TypeScript/Vue 类型错误。
- `npm.cmd run build`：通过，Vite 7.3.6 成功转换 80 个模块并生成生产包。
- 协同评估针对性类型检查：通过，多指标与单指标返回结构均兼容。

### Notes
- 改动文件：
  - `src/pages/PlanningCenter.vue`：增加协同评估摘要、空间比例带、关系表和共同覆盖地图选择。
  - `docs/四中心与智能任务规划前端说明.md`：记录多指标协同评估展示与地图行为。
  - `progress.md`：追加本轮实施、验证与回滚记录。
- `frontend-design` 技能用于复核信息层级，并将通用数字卡片补充为直接表达空间关系的覆盖比例带；未改变既有地学作业台配色和页面结构。
- 回滚方式：先执行 `git diff -- src/pages/PlanningCenter.vue docs/四中心与智能任务规划前端说明.md progress.md > collaborative-planning-frontend.patch` 保存补丁；确认这些文件没有本轮之后的新改动，再对同一文件清单执行 `git restore -- <文件清单>`。

## 2026-07-28 - Task: 复审并收敛规划评价区视觉

### What was done
- 按实际 339px 业务面板修正协同指标布局，四项指标由强制单行改为随容器宽度自动换列，消除侧栏横向溢出。
- 单指标任务使用“指标有效覆盖”语义，多指标任务保留“多指标共同覆盖”；覆盖比例统一显示至最多两位小数。
- 将窄面板中需要横向拖动的五列资源关系表改为紧凑资源组合记录，完整保留协同类型、空间交叠、新增覆盖和计算依据。

### Testing
- `npm.cmd run typecheck`：通过，无 TypeScript/Vue 类型错误。
- `npm.cmd run build`：通过，Vite 7.3.6 成功转换 80 个模块并生成生产包。
- Chrome/Playwright 真实浏览器验收：以 `demo` 演示任务完成优化、增补和满足度评估；1440×1000 与 1024×768 视口下，业务侧栏、评价面板、指标网格和资源组合记录均无横向溢出；单指标文案与 `7.13%` 数值精度正确；无 `pageerror` 和失败请求。截图保存在系统临时目录，未写入仓库。
- `git diff --check`：通过，无空白错误；仅提示既有 LF/CRLF 工作区转换信息。

### Notes
- 改动文件：
  - `src/pages/PlanningCenter.vue`：收敛协同评价布局、单指标文案、百分比精度与资源关系呈现。
  - `progress.md`：追加本轮实施、验证与回滚记录。
- `frontend-design` 用于保持现有地学作业台的青灰配色、紧凑密度和信息层级；浏览器技能的 CLI 在本机不可用，改用项目已安装的 Playwright 和本机 Chrome 完成等价实机验收。
- 回滚方式：由于 `PlanningCenter.vue` 已含此前未提交改动，请执行 `git restore -p -- src/pages/PlanningCenter.vue progress.md`，仅选择本条记录描述的自动换列、单指标文案/精度、`relation-list` 模板与样式以及本日志块，避免整文件回退覆盖既有工作。

## 2026-07-28 - Task: 增加可隐藏业务引导并融合传感器八类档案

### What was done
- 新增可复用的上下文引导组件：首次展示业务阅读顺序，可隐藏、刷新后保持隐藏，并通过轻量入口重新展开。
- 在规划满足度评估中按“任务判定、空间质量、资源组合”解释指标与资源关系，避免用户面对结果数字时缺少行动依据。
- 将“传感器八元组”调整为“传感器详情”：资源列表可携带传感器 ID 直接进入档案，页面先显示当前资源、所属平台、状态与八类档案完整度，再按业务含义维护八类并列信息。
- 移除容易被理解成八步流程的圆形数字和编号页签，改用完成状态点及“身份、能力、位置、维护”等自然语言说明；同步更新导航、搜索目录和使用文档。

### Testing
- `npm.cmd run typecheck`：通过，无 TypeScript/Vue 类型错误。
- `npm.cmd run build`：通过，Vite 7.3.6 成功转换 83 个模块并生成生产包。
- Chrome/Playwright 真实浏览器验收：从传感器资源列表点击“详情档案”正确进入 `/resources/metadata?sensorId=24`；选中资源、导航名称和档案完整度正确；引导隐藏后刷新保持隐藏，重新展开可用；规划评价引导可隐藏并保留恢复入口。
- 浏览器运行检查：传感器详情页与规划评价页在 339px 业务侧栏均无横向溢出，无 `pageerror` 和失败请求。
- 运行状态：前端 HTTP 200；后端 `/api/health/` HTTP 200，返回 `status=ok`。
- `git diff --check`：通过，无空白错误；仅提示既有 LF/CRLF 工作区转换信息。

### Notes
- 改动文件：
  - `src/components/ContextGuide.vue`：新增可持久隐藏、可恢复的作业导线组件。
  - `src/pages/PlanningCenter.vue`：为协同评估增加业务判读引导。
  - `src/pages/SensorMetadataView.vue`：将八元组重组为带资源上下文、完整度和业务说明的传感器详情档案。
  - `src/pages/ResourcesCenter.vue`：在传感器列表增加指定资源的详情档案入口。
  - `src/components/AppLayout.vue`：导航名称由“传感器八元组”调整为“传感器详情”。
  - `src/features/catalog.ts`：同步全局搜索目录名称。
  - `docs/四中心与智能任务规划前端说明.md`：记录引导隐藏规则和八类档案使用方式。
  - `progress.md`：追加本轮实施、验证与回滚记录。
- `frontend-design` 用于把通用教程改造成符合地学作业台的内嵌判读导线，并依据“八类并列档案而非八步流程”的真实结构调整导航和视觉层级。
- 回滚方式：这些文件包含此前未提交工作，请执行 `git restore -p -- src/components/AppLayout.vue src/features/catalog.ts src/pages/PlanningCenter.vue src/pages/ResourcesCenter.vue src/pages/SensorMetadataView.vue docs/四中心与智能任务规划前端说明.md progress.md`，仅选择本条记录对应修改；再执行 `git clean -n -- src/components/ContextGuide.vue` 核对目标，确认后用 `git clean -f -- src/components/ContextGuide.vue` 删除本轮新增组件。

## 2026-07-28 - Task: 完成四中心全局引导、信息层级收敛与 AI 设置

### What was done
- 增加覆盖整套系统的任务闭环引导，按“应用发起—任务定义—资源准备—业务规划—成果回到应用”说明当前阶段、下一步动作和跨中心入口；支持隐藏、刷新记忆、恢复展开与窄屏无障碍名称。
- 首页四中心按真实业务闭环重排，将通用数字卡片收敛为资源、数据、任务三类运行判读；资源中心把卫星和移动轨迹接入折叠为高级入口，使平台与传感器日常管理优先出现。
- 应用中心 GIS 去除重复统计和重复图层开关，只保留一份图层账本；统计标题去除开发编号与实现术语。
- AI 助手增加与现有地学作业台一致的设置视图，只读展示模型服务状态，并保存默认任务方式与技术运行记录显隐；设置实时同步到综合感知任务入口，浏览器不保存 API Key 或服务地址。
- 更新四中心前端说明，明确全局引导、中心信息层级、AI 偏好和密钥边界。

### Testing
- `npm.cmd run typecheck`：通过，无 TypeScript/Vue 类型错误。
- `npm.cmd run build`：通过，Vite 7.3.6 成功转换 89 个模块并生成生产包；仅保留现有大于 500 kB 的单包体积提示。
- `git diff --check`：通过，无空白错误；仅提示既有 LF/CRLF 工作区转换信息。
- 本机服务检查：前端 `http://127.0.0.1:5173/` 与后端 `http://127.0.0.1:8001/api/health/` 均返回 HTTP 200。
- agent-browser 本机 Chrome 实机验收：覆盖 `/`、`/tasks`、`/resources/sensors?tab=crud`、`/business`、`/application`、`/application/tasks`；1440×1000 与 1024×768 均无横向溢出或页面异常。
- 交互验收：全局引导首次展开、隐藏后刷新保持、重新打开和跨中心跳转均正常；资源高级接入默认折叠；应用 GIS 仅有一份图层账本；AI 设置保存“手动创建”后任务页主操作立即同步，偏好正确写入浏览器本地存储。
- 验收截图保存在 `F:\aidata\qa-newcity-20260728\screenshots`，未写入仓库。

### Notes
- 改动文件：
  - `src/components/WorkspaceGuide.vue`：新增可隐藏、可恢复、可跨中心跳转的全局任务闭环引导。
  - `src/components/AppLayout.vue`：在登录后的全局顶部接入使用引导。
  - `src/pages/HomeView.vue`：重排四中心业务闭环并将统计改为运行判读。
  - `src/pages/ResourcesCenter.vue`：将卫星和移动轨迹接入改为默认折叠的高级入口。
  - `src/pages/ApplicationsCenter.vue`：去除重复统计与开发术语，合并为单一图层账本。
  - `src/components/AssistantPanel.vue`：增加模型服务状态和安全的 AI 设置视图。
  - `src/pages/AgentTaskWorkspace.vue`：读取并实时应用默认任务方式和技术详情偏好。
  - `src/utils/aiPreferences.ts`：新增不含密钥的本地 AI 偏好读写与同步事件。
  - `src/styles.css`：将 AI 助手融入测绘青、岩层灰、预警琥珀视觉并补充设置控件样式。
  - `docs/四中心与智能任务规划前端说明.md`：记录业务闭环、中心信息层级和 AI 配置边界。
  - `progress.md`：追加本轮实施、验证和回滚记录。
- `frontend-design` 用于把全局引导、运行判读和 AI 设置统一为地学监测作业语言；`agent-browser` 用于真实浏览器双尺寸交互与页面错误验收。
- 回滚方式：先执行 `git diff -- src/components/AppLayout.vue src/components/AssistantPanel.vue src/pages/AgentTaskWorkspace.vue src/pages/ApplicationsCenter.vue src/pages/HomeView.vue src/pages/ResourcesCenter.vue src/styles.css docs/四中心与智能任务规划前端说明.md progress.md > four-center-guidance-ai-settings.patch` 保存补丁；再用 `git restore -p -- <上述已跟踪文件>` 仅选择本日志块对应改动。新增文件先用 `git clean -n -- src/components/WorkspaceGuide.vue src/utils/aiPreferences.ts` 核对，确认后再执行同一命令的 `-f` 版本删除。

## 2026-07-28 - Task: 去除抽象流程文案并调整顶部搜索图标

### What was done
- 将首页、全局使用引导和算法页面中的“闭环”及成果回流表述改为直接操作语言，统一使用“填写需求、配置指标、检查资源、制定方案”等用户可执行动作。
- 全局引导改用“需求、指标、资源、方案”标记当前用途，不再使用“发起、定义、准备、规划”等方案汇报式阶段名称。
- 顶部搜索框删除左侧重复放大镜和右侧箭头，将唯一的标准搜索图标放进右侧提交按钮，并调整输入区留白与加载状态。
- 同步更新四中心前端说明中的使用顺序描述。

### Testing
- `rg -n "闭环" src docs/四中心与智能任务规划前端说明.md`：无匹配，正式页面源码与使用说明不再出现该词。
- `npm.cmd run typecheck`：通过，无 TypeScript/Vue 类型错误。
- `npm.cmd run build`：通过，Vite 7.3.6 成功转换 89 个模块并生成生产包；仅保留现有大于 500 kB 的单包体积提示。
- `git diff --check`：通过，无空白错误；仅提示既有 LF/CRLF 工作区转换信息。
- agent-browser 本机 Chrome 验收：首页和全局引导使用直接操作文案；搜索框在 1440×1000 与 1024×768 下均无横向溢出，图标在右侧按钮内居中，输入和点击搜索可用，无页面异常。
- 验收截图：`F:\aidata\qa-newcity-20260728\screenshots\copy-search-1440.png`、`copy-search-1024.png`，未写入仓库。

### Notes
- 改动文件：
  - `src/components/WorkspaceGuide.vue`：将抽象流程说明改为直接操作提示。
  - `src/pages/HomeView.vue`：将四中心入口名称和说明改为用户动作语言。
  - `src/pages/AlgorithmsCenter.vue`：将模型处理说明中的“闭环”改为“使用顺序”。
  - `src/components/AppLayout.vue`：移除搜索输入框左侧重复图标。
  - `src/styles.css`：将标准放大镜绘制在右侧搜索按钮并调整输入留白。
  - `docs/四中心与智能任务规划前端说明.md`：同步页面使用顺序和文案规则。
  - `progress.md`：追加本轮实施、验证和回滚记录。
- `frontend-design` 用于删去方案汇报式表达并把搜索控件收敛为单一明确动作；`agent-browser` 用于验证真实顶栏尺寸、搜索交互和页面文案。
- 回滚方式：执行 `git revert <本轮提交号>` 可整体回滚；提交前可先用 `git diff -- src/components/WorkspaceGuide.vue src/pages/HomeView.vue src/pages/AlgorithmsCenter.vue src/components/AppLayout.vue src/styles.css docs/四中心与智能任务规划前端说明.md progress.md > copy-search-fix.patch` 保存补丁，再对同一文件清单执行 `git restore -- <文件清单>`。
