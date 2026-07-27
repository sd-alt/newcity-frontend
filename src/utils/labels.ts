/** 面向用户的状态中文标签与徽章色。 */

const TASK_STATUS: Record<string, { text: string; tone: string }> = {
  draft: { text: '草稿', tone: 'gray' },
  created: { text: '已创建', tone: 'blue' },
  submitted: { text: '已提交', tone: 'blue' },
  running: { text: '执行中', tone: 'blue' },
  completed: { text: '已完成', tone: 'green' },
  done: { text: '已完成', tone: 'green' },
  cancelled: { text: '已取消', tone: 'gray' },
  failed: { text: '失败', tone: 'red' },
}

const PLATFORM_STATUS: Record<string, { text: string; tone: string }> = {
  active: { text: '在线', tone: 'green' },
  online: { text: '在线', tone: 'green' },
  offline: { text: '离线', tone: 'gray' },
  fault: { text: '故障', tone: 'red' },
  maintenance: { text: '维护中', tone: 'amber' },
  retired: { text: '已退役', tone: 'gray' },
}

const QUALITY_STATUS: Record<string, { text: string; tone: string }> = {
  unchecked: { text: '未检查', tone: 'gray' },
  normal: { text: '正常', tone: 'green' },
  passed: { text: '合格', tone: 'green' },
  warning: { text: '预警', tone: 'amber' },
  anomaly: { text: '异常', tone: 'red' },
  failed: { text: '不合格', tone: 'red' },
}

function lookup(
  table: Record<string, { text: string; tone: string }>,
  value: unknown,
): { text: string; tone: string } {
  const key = String(value ?? '').toLowerCase().trim()
  if (!key) return { text: '—', tone: 'gray' }
  return table[key] || { text: String(value), tone: 'gray' }
}

export const taskStatusLabel = (value: unknown) => lookup(TASK_STATUS, value)
export const platformStatusLabel = (value: unknown) => lookup(PLATFORM_STATUS, value)
export const qualityStatusLabel = (value: unknown) => lookup(QUALITY_STATUS, value)