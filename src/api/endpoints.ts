import { apiEnvelope, apiRequest } from './client'
import type { UserInfo } from './types'
import type { AiServiceMode } from '../utils/aiPreferences'

function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['records', 'results', 'items', 'types', 'features', 'candidates']) {
      if (Array.isArray(obj[key])) return obj[key] as T[]
    }
  }
  return []
}

export async function ensureCsrf() {
  return apiRequest('/api/v1/auth/csrf')
}

export async function login(username: string, password: string) {
  await ensureCsrf()
  return apiEnvelope<UserInfo>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function logout() {
  return apiEnvelope('/api/v1/auth/logout', { method: 'POST' })
}

export async function me() {
  return apiEnvelope<UserInfo>('/api/v1/auth/me')
}

export const getMe = me

export async function getHealth() {
  return apiRequest<{ status?: string; service?: string }>('/api/health/')
}

export type ListMeta = { total: number; page: number; pageSize: number }

async function listAny<T = Record<string, unknown>>(path: string) {
  const res = await apiEnvelope<unknown>(path)
  const raw = res.data
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.records)) {
      return {
        ...res,
        data: obj.records as T[],
        total: Number(obj.total ?? (obj.records as unknown[]).length),
        page: Number(obj.page ?? 1),
        pageSize: Number(obj.pageSize ?? ((obj.records as unknown[]).length || 20)),
      }
    }
  }
  const list = asList<T>(raw)
  return {
    ...res,
    data: list,
    total: list.length,
    page: 1,
    pageSize: list.length || 20,
  }
}

async function getAny<T = Record<string, unknown>>(path: string) {
  return apiEnvelope<T>(path)
}

async function createAny(path: string, body: Record<string, unknown>) {
  return apiEnvelope(path, { method: 'POST', body: JSON.stringify(body) })
}

async function updateAny(path: string, body: Record<string, unknown>) {
  return apiEnvelope(path, { method: 'PATCH', body: JSON.stringify(body) })
}

async function deleteAny(path: string) {
  return apiEnvelope(path, { method: 'DELETE' })
}

async function postAction(path: string, body?: Record<string, unknown>) {
  return apiEnvelope(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function fetchText(path: string, timeoutMs = 120_000) {
  return apiRequest<string>(path, {
    headers: { Accept: 'text/csv,application/json,text/plain,*/*' },
    timeoutMs,
  })
}

// 指标
export const listDomains = () => listAny('/api/v1/indicators/domains')
export const listThemes = () => listAny('/api/v1/indicators/themes')
export const listSubThemes = () => listAny('/api/v1/indicators/sub-themes')
export const listScales = () => listAny('/api/v1/indicators/scales')
export const listScenes = () => listAny('/api/v1/association/scenes')
export const listUnits = () => listAny('/api/v1/indicators/units')
export const listDefinitions = () => listAny('/api/v1/indicators/definitions')
export const createDefinition = (body: Record<string, unknown>) => createAny('/api/v1/indicators/definitions', body)
export const updateDefinition = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/indicators/definitions/' + id, body)
export const deleteDefinition = (id: number | string) => deleteAny('/api/v1/indicators/definitions/' + id)
export const listDefinitionVersions = (id: number | string) => listAny('/api/v1/indicators/definitions/' + id + '/versions')
export const listInstances = (query = '') => listAny('/api/v1/indicators/instances' + query)
export const getInstance = (id: number | string) => getAny('/api/v1/indicators/instances/' + id)
export const createInstance = (body: Record<string, unknown>) => createAny('/api/v1/indicators/instances', body)
export const updateInstance = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/indicators/instances/' + id, body)
export const deleteInstance = (id: number | string) => deleteAny('/api/v1/indicators/instances/' + id)
export const exportInstancesCsv = (query = '') => {
  let q = query || ''
  if (q && !q.startsWith('?')) q = '?' + q
  if (!q) q = '?exportFormat=csv'
  else if (!q.includes('exportFormat=')) q += (q.includes('?') ? '&' : '?') + 'exportFormat=csv'
  return fetchText('/api/v1/indicators/instances/export' + q)
}
export const getIndicatorTree = () => getAny('/api/v1/indicators/tree')

// 资源
export const listPlatformTypes = () => listAny('/api/v1/observations/platform-types')
export const listSensorTypes = () => listAny('/api/v1/observations/sensor-types')
export const listPlatforms = (query = '') => listAny('/api/v1/observations/platforms' + query)
export const getPlatform = (id: number | string) => getAny('/api/v1/observations/platforms/' + id)
export const createPlatform = (body: Record<string, unknown>) => createAny('/api/v1/observations/platforms', body)
export const updatePlatform = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/observations/platforms/' + id, body)
export const deletePlatform = (id: number | string) => deleteAny('/api/v1/observations/platforms/' + id)
export const listSensors = (query = '') => listAny('/api/v1/observations/sensors' + query)
export const createSensor = (body: Record<string, unknown>) => createAny('/api/v1/observations/sensors', body)
export const updateSensor = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/observations/sensors/' + id, body)
export const deleteSensor = (id: number | string) => deleteAny('/api/v1/observations/sensors/' + id)
export const getResourceVisualization = (query = '') => getAny('/api/v1/observations/visualization' + query)
export const syncSatelliteOnline = (platformId: number | string) =>
  postAction('/api/v1/observations/tle/sync-online', { platformId: Number(platformId) })
export const accessSatelliteOnline = (body: Record<string, unknown>) =>
  postAction('/api/v1/observations/satellites/access-online', body)
export const listPositionSources = (query = '') =>
  listAny('/api/v1/observations/position-sources' + query)
export const createPositionSource = (body: Record<string, unknown>) =>
  createAny('/api/v1/observations/position-sources', body)
export const updatePositionSource = (platformId: number | string, body: Record<string, unknown>) =>
  updateAny('/api/v1/observations/position-sources/' + platformId, body)
export const ingestPlatformTrack = (body: Record<string, unknown>) =>
  postAction('/api/v1/observations/platform-tracks/ingest', body)

// 数据
export const listDatasets = () => listAny('/api/v1/observations/datasets')
export const createDataset = (body: Record<string, unknown>) => createAny('/api/v1/observations/datasets', body)
export const listObservationData = (query = '') => listAny('/api/v1/observations/data' + query)
export const getObservationData = (id: number | string) => getAny('/api/v1/observations/data/' + id)
export const createObservationData = (body: Record<string, unknown>) => createAny('/api/v1/observations/data', body)
export const updateObservationData = (id: number | string, body: Record<string, unknown>) =>
  updateAny('/api/v1/observations/data/' + id, body)
export const deleteObservationData = (id: number | string) => deleteAny('/api/v1/observations/data/' + id)
export const listDataSources = () => listAny('/api/v1/observations/data-sources')
export const createDataSource = (body: Record<string, unknown>) => createAny('/api/v1/observations/data-sources', body)
export const updateDataSource = (id: number | string, body: Record<string, unknown>) =>
  updateAny('/api/v1/observations/data-sources/' + id, body)
export const testDataSource = (id: number | string) => postAction('/api/v1/observations/data-sources/' + id + '/test-connection')
export const pullDataSource = (id: number | string, body: Record<string, unknown>) =>
  postAction('/api/v1/observations/data-sources/' + id + '/pull', body)
export const startLiveDataSource = (id: number | string, body: Record<string, unknown>) =>
  postAction('/api/v1/observations/data-sources/' + id + '/start-live', body)
export const stopLiveDataSource = (id: number | string) =>
  postAction('/api/v1/observations/data-sources/' + id + '/stop-live')
export const getLiveDataSourceStatus = (id: number | string) =>
  getAny('/api/v1/observations/data-sources/' + id + '/live-status')
export const getSampleLiveFeed = () => getAny('/api/v1/observations/sample-live-feed/')
export const listDataSourceAudits = (query = '') => listAny('/api/v1/observations/data-source-audits' + query)
export const listFileImports = () => listAny('/api/v1/observations/file-imports')
export const exportObservationDataCsv = (query = '') =>
  fetchText('/api/v1/observations/data/export' + (query ? (query.startsWith('?') ? query : '?' + query) : ''))
export const exportObservationData = (query = '') => exportObservationDataCsv(query)
export const getDataVisualization = () => getAny('/api/v1/observations/visualization')

// AI 助手
export type AssistantAction = {
  type: string
  label?: string
  route?: string
  tab?: string
  taskId?: number
  taskCode?: string
  taskName?: string
  runId?: string
}
export type AssistantChatData = {
  reply: string
  intent: string
  mode: string
  actions: AssistantAction[]
  runId?: string
  suggestions?: string[]
}
export type AssistantStatusData = {
  mode: string
  model: string
  ready: boolean
  apiConfigured: boolean
}
export type AssistantApiConfig = {
  apiBase: string
  apiKey: string
  model: string
}
export type AssistantModelsData = {
  models: string[]
  temporary: boolean
}
export const assistantStatus = () => apiEnvelope<AssistantStatusData>('/api/v1/assistant/status')
export const assistantChat = (message: string, mode?: AiServiceMode, apiConfig?: AssistantApiConfig) =>
  apiEnvelope<AssistantChatData>('/api/v1/assistant/chat', {
    method: 'POST',
    timeoutMs: 120_000,
    body: JSON.stringify({
      message,
      ...(mode ? { mode } : {}),
      ...(apiConfig?.apiBase && apiConfig.apiKey ? { apiConfig } : {}),
    }),
  })
export const assistantModels = (apiConfig: AssistantApiConfig) =>
  apiEnvelope<AssistantModelsData>('/api/v1/assistant/models', {
    method: 'POST',
    timeoutMs: 20_000,
    body: JSON.stringify({ apiConfig }),
  })

// 规划
export const listEvents = () => listAny('/api/v1/planning/events')
export const listTasks = () => listAny('/api/v1/planning/tasks')
export const getTask = (id: number | string) => getAny('/api/v1/planning/tasks/' + id)
export const createTask = (body: Record<string, unknown>) => createAny('/api/v1/planning/tasks', body)
export const updateTask = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/planning/tasks/' + id, body)
export const deleteTask = (id: number | string) => deleteAny('/api/v1/planning/tasks/' + id)
export const submitTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/submit')
export const cancelTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/cancel')
export const approveTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/approve')
export const startTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/start')
export const pauseTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/pause')
export const completeTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/complete')
export const archiveTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/archive')
export const addTaskIndicators = (id: number | string, instanceIds: number[]) =>
  postAction('/api/v1/planning/tasks/' + id + '/add-indicators', { indicatorInstanceIds: instanceIds })
export const screenTaskCandidates = (id: number | string) =>
  postAction('/api/v1/planning/tasks/' + id + '/candidate-screening')
export const basicAssociation = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/basic-association')
export const optimizeAssociation = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/optimize-association')
export const supplementAssociation = (id: number | string) =>
  postAction('/api/v1/planning/tasks/' + id + '/supplement-association', { maxAdditionalResources: 1 })
export const requirementReverse = (id: number | string) => getAny('/api/v1/planning/tasks/' + id + '/requirement-reverse')
export const requirementEvaluation = (id: number | string) => getAny('/api/v1/planning/tasks/' + id + '/requirement-evaluation')
export const planningOutput = (id: number | string) => getAny('/api/v1/planning/tasks/' + id + '/planning-output')
export const resourceCandidates = (id: number | string, query = '') =>
  getAny('/api/v1/planning/tasks/' + id + '/resource-candidates' + query)
export const indicatorCandidates = (id: number | string) => getAny('/api/v1/planning/tasks/' + id + '/indicator-candidates')
export const listPlans = () => listAny('/api/v1/association/plans')
export const listOptimizationTasks = () => listAny('/api/v1/association/optimization-tasks')
export const getAssociationResult = (planId: number | string) => getAny('/api/v1/association/result/' + planId)
export const archivePlan = (id: number | string) => postAction('/api/v1/association/plans/' + id + '/archive')
export const publishPlan = (id: number | string) => postAction('/api/v1/association/plans/' + id + '/publish')
export const copyPlan = (id: number | string, body: Record<string, unknown> = {}) =>
  postAction('/api/v1/association/plans/' + id + '/copy', body)
export const approvePlan = (id: number | string) => postAction('/api/v1/association/plans/' + id + '/approve')
export const comparePlans = (id: number | string, otherId: number | string) =>
  getAny('/api/v1/association/plans/' + id + '/compare?otherId=' + encodeURIComponent(String(otherId)))

// 算法
export const listAlgorithmModels = () => listAny('/api/v1/algorithms/models')
export const createAlgorithmModel = (body: Record<string, unknown>) => createAny('/api/v1/algorithms/models', body)
export const deleteAlgorithmModel = (id: number | string) => deleteAny('/api/v1/algorithms/models/' + id)
export const enableAlgorithmModel = (id: number | string) => postAction('/api/v1/algorithms/models/' + id + '/enable')
export const disableAlgorithmModel = (id: number | string) => postAction('/api/v1/algorithms/models/' + id + '/disable')
export const listModelVersions = (query = '') => listAny('/api/v1/algorithms/model-versions' + query)
export const createModelVersion = (body: Record<string, unknown>) => createAny('/api/v1/algorithms/model-versions', body)
export const publishModelVersion = (id: number | string) => postAction('/api/v1/algorithms/model-versions/' + id + '/publish')
export const retireModelVersion = (id: number | string) => postAction('/api/v1/algorithms/model-versions/' + id + '/retire')
export const listProcessingTasks = () => listAny('/api/v1/algorithms/processing-tasks')
export const getProcessingTask = (id: number | string) => getAny('/api/v1/algorithms/processing-tasks/' + id)
export const createProcessingTask = (body: Record<string, unknown>) => createAny('/api/v1/algorithms/processing-tasks', body)
export const deleteProcessingTask = (id: number | string) => deleteAny('/api/v1/algorithms/processing-tasks/' + id)
export const runProcessingTask = (id: number | string, body: Record<string, unknown> = { asyncMode: true }) => postAction('/api/v1/algorithms/processing-tasks/' + id + '/run', body)
export const cancelProcessingTask = (id: number | string) => postAction('/api/v1/algorithms/processing-tasks/' + id + '/cancel')
export const requeueProcessingTask = (id: number | string) => postAction('/api/v1/algorithms/processing-tasks/' + id + '/requeue')
export const pauseProcessingTask = (id: number | string) => postAction('/api/v1/algorithms/processing-tasks/' + id + '/pause')
export const resumeProcessingTask = (id: number | string, body: Record<string, unknown> = { autoRun: true }) => postAction('/api/v1/algorithms/processing-tasks/' + id + '/resume', body)
export const downloadProcessingResult = (id: number | string) =>
  fetchText('/api/v1/algorithms/processing-tasks/' + id + '/download-result')
export const verifyProcessingTask = (id: number | string, body: Record<string, unknown> = {}) =>
  postAction('/api/v1/algorithms/processing-tasks/' + id + '/verify', body)
export const publishProcessingResult = (id: number | string) =>
  postAction('/api/v1/algorithms/processing-tasks/' + id + '/publish-result')
export const archiveProcessingResult = (id: number | string) =>
  postAction('/api/v1/algorithms/processing-tasks/' + id + '/archive-result')
export const linkProcessingContext = (id: number | string, body: Record<string, unknown>) =>
  postAction('/api/v1/algorithms/processing-tasks/' + id + '/link-context', body)

// 应用
export const resourceStatistics = (query = '') =>
  getAny<Record<string, unknown>>('/api/v1/applications/statistics/resources' + query)
export const dataStatistics = (query = '') =>
  getAny<Record<string, unknown>>('/api/v1/applications/statistics/data' + query)
export const taskStatistics = (query = '') =>
  getAny<Record<string, unknown>>('/api/v1/applications/statistics/tasks' + query)
export const getSensorGis = (bbox?: string) => {
  const q = bbox ? ('?bbox=' + encodeURIComponent(bbox)) : ''
  return getAny<{ total?: number; features?: Record<string, unknown>[] }>('/api/v1/applications/gis/sensors' + q)
}
export const getDataGis = (query = '') =>
  getAny<{ total?: number; features?: Record<string, unknown>[] }>('/api/v1/applications/gis/data' + query)
export const getTaskGis = (query = '') =>
  getAny<{ total?: number; features?: Record<string, unknown>[] }>('/api/v1/applications/gis/tasks' + query)
export const getGisWorkbench = () => getAny('/api/v1/applications/workbench')
export const listGisLayers = () => listAny('/api/v1/applications/gis-layers')

// 数据源生命周期
export const enableDataSource = (id: number | string) => postAction('/api/v1/observations/data-sources/' + id + '/enable')
export const disableDataSource = (id: number | string) => postAction('/api/v1/observations/data-sources/' + id + '/disable')

// 文件导入流程
export const executeFileImport = (id: number | string) => postAction('/api/v1/observations/file-imports/' + id + '/execute')
export const pauseFileImport = (id: number | string) => postAction('/api/v1/observations/file-imports/' + id + '/pause')
export const resumeFileImport = (id: number | string) => postAction('/api/v1/observations/file-imports/' + id + '/resume')
export const retryFileImport = (id: number | string) => postAction('/api/v1/observations/file-imports/' + id + '/retry')

// 观测数据质量 / 下载
export const qualityCheckData = (id: number | string) => postAction('/api/v1/observations/data/' + id + '/quality-check')
export const quarantineData = (id: number | string) => postAction('/api/v1/observations/data/' + id + '/quarantine')
export const releaseData = (id: number | string) => postAction('/api/v1/observations/data/' + id + '/release')
export const spatialPreviewData = (id: number | string) => getAny('/api/v1/observations/data/' + id + '/spatial-preview')
export const dataProvenance = (id: number | string) => getAny('/api/v1/observations/data/' + id + '/provenance')

// 文件导入上传（multipart）
export async function importObservationFile(form: FormData) {
  return apiEnvelope('/api/v1/observations/file-imports/import-file', {
    method: 'POST',
    body: form,
    timeoutMs: 120_000,
  })
}

export const downloadImportTemplate = (fileFormat = 'csv') =>
  fetchText('/api/v1/observations/file-imports/template?fileFormat=' + encodeURIComponent(fileFormat))

// 实例版本
export const listInstanceVersions = (id: number | string) =>
  listAny('/api/v1/indicators/instances/' + id + '/versions')
export const compareInstanceVersions = (id: number | string, fromV: number | string, toV: number | string) =>
  getAny('/api/v1/indicators/instances/' + id + '/versions/compare?from=' + fromV + '&to=' + toV)
export const rollbackInstanceVersion = (id: number | string, version: number | string) =>
  postAction('/api/v1/indicators/instances/' + id + '/versions/' + version + '/rollback')

// 四中心业务 API
export const listSensingElements = () => listAny('/api/v1/task/sensing-elements')
export const createSensingElement = (body: Record<string, unknown>) => createAny('/api/v1/task/sensing-elements', body)
export const listIndicatorSystems = (query = '') => listAny('/api/v1/task/indicator-systems' + query)
export const createIndicatorSystem = (body: Record<string, unknown>) => createAny('/api/v1/task/indicator-systems', body)
export const updateIndicatorSystem = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/task/indicator-systems/' + id, body)
export const createIndicatorSystemVersion = (id: number | string, changeSummary = '') =>
  postAction('/api/v1/task/indicator-systems/' + id + '/version', { changeSummary })
export const listIndicatorNodes = (query = '') => listAny('/api/v1/task/indicator-nodes' + query)
export const createIndicatorNode = (body: Record<string, unknown>) => createAny('/api/v1/task/indicator-nodes', body)
export const updateIndicatorNode = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/task/indicator-nodes/' + id, body)
export const deleteIndicatorNode = (id: number | string) => deleteAny('/api/v1/task/indicator-nodes/' + id)
export const listTaskIndicatorSystems = () => listAny('/api/v1/task/task-indicator-systems')
export const createTaskIndicatorSystem = (body: Record<string, unknown>) => createAny('/api/v1/task/task-indicator-systems', body)
export const updateTaskIndicatorSystem = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/task/task-indicator-systems/' + id, body)
export const confirmTaskIndicatorSystem = (id: number | string) => postAction('/api/v1/task/task-indicator-systems/' + id + '/confirm')

export const getSensorOctuple = (id: number | string) => getAny('/api/v1/resource/sensors/' + id + '/octuple')
export const updateSensorOctuple = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/resource/sensors/' + id + '/octuple', body)
export const listOmObservations = (query = '') => listAny('/api/v1/resource/observations' + query)
export const createOmObservation = (body: Record<string, unknown>) => createAny('/api/v1/resource/observations', body)
export const listAlgorithmServices = () => listAny('/api/v1/resource/algorithm-services')
export const createAlgorithmService = (body: Record<string, unknown>) => createAny('/api/v1/resource/algorithm-services', body)
export const updateAlgorithmService = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/resource/algorithm-services/' + id, body)
export const deleteAlgorithmService = (id: number | string) => deleteAny('/api/v1/resource/algorithm-services/' + id)
export const listKnowledgeItems = (query = '') => listAny('/api/v1/resource/knowledge-items' + query)
export const createKnowledgeItem = (body: Record<string, unknown>) => createAny('/api/v1/resource/knowledge-items', body)
export const updateKnowledgeItem = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/resource/knowledge-items/' + id, body)
export const deleteKnowledgeItem = (id: number | string) => deleteAny('/api/v1/resource/knowledge-items/' + id)

export const listMonitoringDemands = () => listAny('/api/v1/application/demands')
export const createMonitoringDemand = (body: Record<string, unknown>) => createAny('/api/v1/application/demands', body)
export const listCapabilityEvaluations = (query = '') => listAny('/api/v1/business/capability-evaluations' + query)
export const listPlanResources = (query = '') => listAny('/api/v1/business/plan-resources' + query)
export const listPlanEvaluations = (query = '') => listAny('/api/v1/business/plan-evaluations' + query)
export const listExecutionItems = (query = '') => listAny('/api/v1/business/execution-items' + query)
export const listTaskResults = (query = '') => listAny('/api/v1/business/task-results' + query)
export const runBusinessAction = (objectType: 'tasks' | 'plans', id: number | string, action: string, body: Record<string, unknown> = {}) =>
  postAction(`/api/v1/business/${objectType}/${id}/${action}`, body)

export type AgentWorkflowNode = {
  id: number
  code: string
  index: number
  nodeId: string
  nodeType: string
  name: string
  executorType: string
  agentCode: string | null
  agentName: string
  status: string
  mandatory: boolean
  riskLevel: string
  planningReason: string
  topologicalLevel: number
  dependsOn: string[]
  toolNames: string[]
  allowedToolNames: string[]
  inputSummary: Record<string, unknown>
  outputSummary: Record<string, unknown>
  errorMessage: string
  startedAt?: string | null
  finishedAt?: string | null
}
export type AgentWorkflowData = {
  name: string
  mode: 'fixed-maf' | 'template-maf' | 'dynamic-maf'
  source: 'llm' | 'template' | 'fallback' | 'pending' | 'manual'
  graphType: string
  goal: string
  graphVersion: number
  checkpointId: string
  status: string
  fallback: boolean
  fallbackReason: string
  nodeCount: number
  edgeCount: number
  nodes: AgentWorkflowNode[]
  edges: Array<{ id: number; sourceNodeId: string; targetNodeId: string; relation: string }>
  events?: Array<Record<string, unknown>>
}
export type AgentModelCallData = {
  id: number
  stageId?: number | null
  phase: string
  agentCode: string
  provider: string
  model: string
  promptVersion: string
  status: string
  requestTokens: number
  responseTokens: number
  totalTokens: number
  latencyMs: number
  schemaRepairAttempts: number
  fallbackReason: string
  userAdopted?: boolean | null
  errorMessage: string
}
export type AgentRunData = Record<string, unknown> & {
  id: string
  status: string
  currentStage: string
  progress: number
  workflow?: AgentWorkflowData
  planningWorkflow?: AgentWorkflowData
  executionWorkflow?: AgentWorkflowData
  stages?: AgentWorkflowNode[]
  pendingApprovals?: Array<Record<string, unknown>>
  toolCalls?: Array<Record<string, unknown>>
  artifacts?: Array<Record<string, unknown>>
  modelCalls?: AgentModelCallData[]
}
export const createAgentTask = (body: Record<string, unknown>) =>
  apiEnvelope<Record<string, unknown>>('/api/application/agent-tasks/', { method: 'POST', body: JSON.stringify(body) })
export const getAgentRun = (runId: string) => apiEnvelope<AgentRunData>(`/api/agent/runs/${runId}/`)
export const sendAgentMessage = (runId: string, message: string) =>
  apiEnvelope<AgentRunData>(`/api/agent/runs/${runId}/messages/`, { method: 'POST', body: JSON.stringify({ message }) })
export const decideAgentApproval = (runId: string, approvalId: number | string, decision: 'approved' | 'rejected', note = '') =>
  apiEnvelope<AgentRunData>(`/api/agent/runs/${runId}/approvals/${approvalId}/`, { method: 'POST', body: JSON.stringify({ decision, note }) })
export const controlAgentRun = (runId: string, action: 'pause' | 'resume' | 'retry' | 'cancel' | 'takeover') =>
  apiEnvelope<AgentRunData>(`/api/agent/runs/${runId}/${action}/`, { method: 'POST' })
export const agentRunEventsUrl = (runId: string) => `/api/agent/runs/${runId}/events/`
export type AgentPendingAction = {
  runId: string
  taskId: number | null
  demandId: number
  taskName: string
  status: 'waiting_input' | 'waiting_approval'
  currentStage: string
  stageName: string
  actionType: 'input' | 'approval'
  approvalId: number
  approvalType: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
}
export const listAgentPendingActions = () => apiEnvelope<AgentPendingAction[]>('/api/agent/runs/pending-actions/')
