export type FeatureItem = {
  center: string
  module: string
  name: string
  route: string
  tab: string
}

export const FEATURES: FeatureItem[] = [
  { center: '感知指标中心', module: '指标样例管理', name: '指标样例维护', route: '/indicators', tab: 'samples' },
  { center: '感知指标中心', module: '指标实例化', name: '指标实例生成', route: '/indicators', tab: 'instances' },
  { center: '感知指标中心', module: '实例化指标查询', name: '指标树展示', route: '/indicators', tab: 'tree' },
  { center: '感知指标中心', module: '实例化指标查询', name: '实例查询导出', route: '/indicators', tab: 'query' },
  { center: '感知指标中心', module: '版本控制', name: '指标实例版本管理', route: '/indicators', tab: 'versions' },
  { center: '传感资源中心', module: '传感器类型管理', name: '传感器类型维护', route: '/resources', tab: 'types' },
  { center: '传感资源中心', module: '多类传感器建模', name: '传感器增删改查', route: '/resources', tab: 'crud' },
  { center: '传感资源中心', module: '资源查询', name: '传感器综合查询', route: '/resources', tab: 'query' },
  { center: '传感资源中心', module: '资源可视化', name: '传感器可视化', route: '/resources', tab: 'viz' },
  { center: '观测数据中心', module: '监测数据建模', name: '监测数据增删改查', route: '/data', tab: 'crud' },
  { center: '观测数据中心', module: '多源数据接入', name: '多源监测数据接入', route: '/data', tab: 'sources' },
  { center: '观测数据中心', module: '数据查询', name: '监测数据综合查询', route: '/data', tab: 'query' },
  { center: '观测数据中心', module: '数据可视化', name: '监测数据可视化', route: '/data', tab: 'viz' },
  { center: '观测规划中心', module: '任务建模', name: '观测任务增删改查', route: '/planning', tab: 'tasks' },
  { center: '观测规划中心', module: '任务建模', name: '指标实例选择', route: '/planning', tab: 'tasks' },
  { center: '观测规划中心', module: '需求分析', name: '需求反算', route: '/planning', tab: 'flow' },
  { center: '观测规划中心', module: '候选资源处理', name: '候选传感器筛选', route: '/planning', tab: 'candidates' },
  { center: '观测规划中心', module: '关联评价', name: '评分与解释', route: '/planning', tab: 'candidates' },
  { center: '观测规划中心', module: '指标—观测关联', name: '基础关联', route: '/planning', tab: 'flow' },
  { center: '观测规划中心', module: '指标—观测关联', name: '优化关联', route: '/planning', tab: 'flow' },
  { center: '观测规划中心', module: '指标—观测关联', name: '增补关联', route: '/planning', tab: 'flow' },
  { center: '观测规划中心', module: '方案管理', name: '规划方案管理', route: '/planning', tab: 'plans' },
  { center: '观测规划中心', module: '结果输出', name: '规划结果输出', route: '/planning', tab: 'flow' },
  { center: '算法处理中心', module: '算法模型管理', name: '算法增删改查', route: '/algorithms', tab: 'models' },
  { center: '算法处理中心', module: '处理任务管理', name: '处理任务创建', route: '/algorithms', tab: 'tasks' },
  { center: '算法处理中心', module: '任务调度执行', name: '任务调度与执行', route: '/algorithms', tab: 'run' },
  { center: '算法处理中心', module: '过程监控', name: '处理过程监控', route: '/algorithms', tab: 'monitor' },
  { center: '算法处理中心', module: '结果管理', name: '处理结果管理', route: '/algorithms', tab: 'results' },
  { center: '综合应用中心', module: 'GIS综合展示', name: '传感器GIS展示', route: '/gis', tab: 'sensors' },
  { center: '综合应用中心', module: 'GIS综合展示', name: '监测数据GIS展示', route: '/gis', tab: 'data' },
  { center: '综合应用中心', module: 'GIS综合展示', name: '观测任务GIS展示', route: '/gis', tab: 'tasks' },
  { center: '综合应用中心', module: '综合统计', name: '传感资源统计', route: '/applications', tab: 'stats' },
  { center: '综合应用中心', module: '综合统计', name: '监测数据统计', route: '/applications', tab: 'stats' },
  { center: '综合应用中心', module: '综合统计', name: '观测任务统计', route: '/applications', tab: 'stats' },
]
