# newcity-frontend

地学传感网前端（Vue 3 + TypeScript + Cesium），严格对齐《系统建设任务清单与工作量表》图1-3的四中心 **22 项**。

当前发布分支为 `main`，前端仓库为 `sd-alt/newcity-frontend`。本地默认通过 Vite 将 `/api` 代理到 `http://127.0.0.1:8001`。

## 22 项入口

| 中心 | 路由 | 页内 Tab | 文档功能项 |
| --- | --- | --- | --- |
| 任务中心 | `/tasks` | task-create / task-manage / modeling / systems / versions | 任务创建、任务管理、指标创建、指标体系管理、指标版本与追溯 |
| 资源中心 | `/resources/*` | sensors / capabilities / data / algorithms / knowledge | 传感器资源、观测能力、数据建模与接入、观测数据、算法模型与服务、知识管理与应用 |
| 业务中心 | `/business` | tasks / candidates / evaluation / flow | 需求查询、资源选择、能力评估、资源配置 |
| 应用中心 | `/application*` | workbench / tasks / gis / progress / stats | 场景主题配置、场景任务发起、GIS 展示、任务进程与成果、场景统计分析 |

## 关键交互约定

1. **规划**：严格分步（创建 → 提交 → 基础关联 → 优化 → 增补 → 评估 → 输出），**没有一键跑通**。
2. **算法闭环**：创建模型时可自动注册并发布版本 → 选择 active 版本创建处理任务 → 执行/终止/重新排队 → 查看日志与结果。
3. **方案**：任务关联产生方案；支持查看关联结果、发布、归档。
4. **指标实例版本**：支持实例版本历史、版本对比、回退；同时可查看样例定义版本历史。
5. **数据文件导入**：多源接入页支持 CSV 模板下载与 multipart 上传导入。

## 启动

```powershell
cd F:\aidata\newcity
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8001

cd F:\aidata\newcity-frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

演示账号：`demo` / `demo-pass`

代理：`/api` → `http://127.0.0.1:8001`

## 验证

```powershell
npm run typecheck
npm run build
```

浏览器：登录后从首页 22 项功能矩阵进入各中心，按 Tab 验收。

GIS 综合展示的快速定位可选择首颗卫星或首架无人机。卫星轨迹来自后端活动 TLE/SGP4 推演并显示公里高度；无人机轨迹来自后端位置遥测并显示米制高度。没有轨迹数据的平台只显示登记位置和原因，前端不生成模拟路线。地图详情、图例、聚合和视角规则见 [`docs/四中心与智能任务规划前端说明.md`](docs/四中心与智能任务规划前端说明.md)。

后端端口、位置源协议、演示遥测边界和部署说明见后端仓库的 [卫星与移动平台位置接入及服务器运行说明](https://github.com/sd-alt/newcity/blob/main/docs/%E5%8D%AB%E6%98%9F%E4%B8%8E%E7%A7%BB%E5%8A%A8%E5%B9%B3%E5%8F%B0%E4%BD%8D%E7%BD%AE%E6%8E%A5%E5%85%A5%E5%8F%8A%E6%9C%8D%E5%8A%A1%E5%99%A8%E8%BF%90%E8%A1%8C%E8%AF%B4%E6%98%8E.md)。

## 数据中心 · 多源协议接入

「多源数据接入」页是**协议数据源工作台**，不是文件上传主入口：

1. 登记协议端点（HTTP/HTTPS 等）、鉴权引用、字段映射、接入策略  
2. 测试连接 → 启用  
3. **立即拉取** 写入观测数据（`source:<编码>` 可追溯）  
4. 查看接入审计与失败提示  

文件导入在同页底部，仅作离线/样例通道。

