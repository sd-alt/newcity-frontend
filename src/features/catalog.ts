export type FeatureItem = {
  center: string
  module: string
  name: string
  route: string
  tab: string
}

export const FEATURES: FeatureItem[] = [
  { center: '任务中心', module: '指标建模', name: '基础指标体系', route: '/tasks', tab: 'systems' },
  { center: '任务中心', module: '指标建模', name: '六层手工指标建模', route: '/tasks', tab: 'modeling' },
  { center: '任务中心', module: '指标管理', name: '任务指标体系', route: '/tasks', tab: 'task-systems' },
  { center: '任务中心', module: '指标管理', name: '版本与追溯', route: '/tasks', tab: 'versions' },
  { center: '资源中心', module: '观测能力库', name: '传感器类型管理', route: '/resources/sensors', tab: 'types' },
  { center: '资源中心', module: '观测能力库', name: '传感器资源管理', route: '/resources/sensors', tab: 'crud' },
  { center: '资源中心', module: '观测能力库', name: '传感器详情与八类档案', route: '/resources/metadata', tab: '' },
  { center: '资源中心', module: '观测数据库', name: '观测数据管理', route: '/resources/data', tab: 'query' },
  { center: '资源中心', module: '观测数据库', name: '多源数据接入', route: '/resources/data', tab: 'sources' },
  { center: '资源中心', module: '算法模型库', name: '算法模型与服务', route: '/resources/algorithms', tab: 'models' },
  { center: '资源中心', module: '知识库', name: '知识检索与管理', route: '/resources/knowledge', tab: '' },
  { center: '业务中心', module: '任务管理', name: '观测任务管理', route: '/business', tab: 'tasks' },
  { center: '业务中心', module: '资源匹配', name: '查选算评', route: '/business', tab: 'flow' },
  { center: '业务中心', module: '资源匹配', name: '候选资源与评分', route: '/business', tab: 'candidates' },
  { center: '业务中心', module: '观测规划', name: '资源配置与优化', route: '/business', tab: 'flow' },
  { center: '业务中心', module: '方案管理', name: '观测方案与评价', route: '/business', tab: 'plans' },
  { center: '业务中心', module: '执行与成果', name: '任务执行与成果', route: '/business/execution', tab: '' },
  { center: '应用中心', module: '任务需求交互', name: '场景任务发起', route: '/application/tasks', tab: '' },
  { center: '应用中心', module: '综合态势展示', name: 'GIS 综合展示', route: '/application', tab: 'gis' },
  { center: '应用中心', module: '任务进程与成果', name: 'Agent 任务进程', route: '/application/tasks', tab: '' },
  { center: '应用中心', module: '综合分析', name: '场景统计分析', route: '/application', tab: 'stats' },
]
