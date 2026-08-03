export type FeatureItem = {
  center: string
  module: string
  name: string
  route: string
  tab: string
}

export const FEATURES: FeatureItem[] = [
  { center: '任务中心', module: '任务管理', name: '任务创建', route: '/tasks', tab: 'task-create' },
  { center: '任务中心', module: '任务管理', name: '任务管理', route: '/tasks', tab: 'task-manage' },
  { center: '任务中心', module: '指标管理', name: '指标体系建模', route: '/tasks', tab: 'modeling' },
  { center: '任务中心', module: '指标管理', name: '指标体系管理', route: '/tasks', tab: 'systems' },
  { center: '任务中心', module: '指标管理', name: '指标版本与追溯', route: '/tasks', tab: 'versions' },
  { center: '资源中心', module: '观测能力库', name: '传感器资源管理', route: '/resources/sensors', tab: 'crud' },
  { center: '资源中心', module: '观测能力库', name: '观测能力管理', route: '/resources/sensors', tab: 'capabilities' },
  { center: '资源中心', module: '观测数据库', name: '数据资源建模与接入', route: '/resources/data', tab: 'sources' },
  { center: '资源中心', module: '观测数据库', name: '观测数据管理', route: '/resources/data', tab: 'query' },
  { center: '资源中心', module: '算法模型库', name: '算法模型管理', route: '/resources/algorithms', tab: 'models' },
  { center: '资源中心', module: '算法模型库', name: '算法服务管理', route: '/resources/algorithms', tab: 'services' },
  { center: '资源中心', module: '知识库', name: '知识建模与管理', route: '/resources/knowledge', tab: 'edit' },
  { center: '资源中心', module: '知识库', name: '知识检索与应用', route: '/resources/knowledge', tab: 'search' },
  { center: '业务中心', module: '任务处理', name: '需求查询', route: '/business', tab: 'tasks' },
  { center: '业务中心', module: '任务处理', name: '过程管理与成果追溯', route: '/business/execution', tab: '' },
  { center: '业务中心', module: '资源匹配与评估', name: '资源选择', route: '/business', tab: 'candidates' },
  { center: '业务中心', module: '资源匹配与评估', name: '能力评估', route: '/business', tab: 'evaluation' },
  { center: '业务中心', module: '资源配置', name: '资源配置', route: '/business', tab: 'flow' },
  { center: '业务中心', module: '资源配置', name: '方案管理', route: '/business', tab: 'plans' },
  { center: '应用中心', module: '场景应用', name: '场景主题配置', route: '/application', tab: 'workbench' },
  { center: '应用中心', module: '场景应用', name: '场景任务发起', route: '/application/tasks', tab: '' },
  { center: '应用中心', module: '态势展示', name: 'GIS综合展示', route: '/application', tab: 'gis' },
  { center: '应用中心', module: '态势展示', name: '任务进程与成果查看', route: '/application/tasks', tab: 'progress' },
  { center: '应用中心', module: '综合分析', name: '场景统计分析', route: '/application', tab: 'stats' },
]
