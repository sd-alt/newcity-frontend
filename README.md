# newcity-frontend

地学传感网前端（Vue 3 + TypeScript + Cesium），严格对齐《系统建设任务清单与工作量表》第一阶段 **34 项**。

## 34 项入口

| 中心 | 路由 | 页内 Tab | 文档功能项 |
| --- | --- | --- | --- |
| 感知指标中心 | `/indicators` | samples / instances / tree / query / versions | 样例维护、实例生成、指标树、查询导出、实例版本（发布/停用/回退 + 定义版本追溯） |
| 传感资源中心 | `/resources` | types / crud / query / viz | 类型维护、传感器 CRUD、综合查询、可视化 |
| 观测数据中心 | `/data` | crud / sources / query / viz | 数据 CRUD、多源接入、查询导出、可视化 |
| 观测规划中心 | `/planning` | tasks / flow / candidates / plans | 任务 CRUD、指标选择、候选筛选、评分解释、基础/优化/增补关联、需求反算、方案管理、结果输出 |
| 算法处理中心 | `/algorithms` | models / tasks / run / monitor / results | 模型+版本、任务创建、调度执行/终止/重排、过程监控、结果管理 |
| 综合应用中心 | `/applications` | stats / gis / workbench | 三类统计 + GIS 入口 |
| GIS 工作台 | `/gis` | `?tab=sensors|data|tasks` | 传感器/数据/任务图层；`?taskId=` 任务定位 |

## 关键交互约定

1. **规划**：严格分步（创建 → 提交 → 基础关联 → 优化 → 增补 → 评估 → 输出），**没有一键跑通**。
2. **算法闭环**：创建模型时可自动注册并发布版本 → 选择 active 版本创建处理任务 → 执行/终止/重新排队 → 查看日志与结果。
3. **方案**：任务关联产生方案；支持查看关联结果、发布、归档。
4. **指标实例版本**：支持实例版本历史、版本对比、回退；同时可查看样例定义版本历史。
5. **数据文件导入**：多源接入页支持 CSV 模板下载与 multipart 上传导入。

## 启动

```powershell
cd F:\aidata\newcity
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000

cd F:\aidata\newcity-frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

演示账号：`demo` / `demo-pass`

代理：`/api` → `http://127.0.0.1:8000`

## 验证

```powershell
npm run typecheck
npm run build
```

浏览器：登录后从首页 34 项矩阵进入各中心，按 Tab 验收。

## 数据中心 · 多源协议接入

「多源数据接入」页是**协议数据源工作台**，不是文件上传主入口：

1. 登记协议端点（HTTP/HTTPS 等）、鉴权引用、字段映射、接入策略  
2. 测试连接 → 启用  
3. **立即拉取** 写入观测数据（`source:<编码>` 可追溯）  
4. 查看接入审计与失败提示  

文件导入在同页底部，仅作离线/样例通道。

