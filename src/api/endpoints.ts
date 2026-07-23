import { apiEnvelope, apiRequest } from './client'
import type { UserInfo } from './types'

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

async function fetchText(path: string) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'text/csv,application/json,text/plain,*/*' },
  })
  const text = await response.text()
  if (response.ok === false) {
    throw new Error(text || response.statusText)
  }
  return text
}

// indicators
export const listDomains = () => listAny('/api/v1/indicators/domains')
export const listThemes = () => listAny('/api/v1/indicators/themes')
export const listScales = () => listAny('/api/v1/indicators/scales')
export const listUnits = () => listAny('/api/v1/indicators/units')
export const listDefinitions = () => listAny('/api/v1/indicators/definitions')
export const createDefinition = (body: Record<string, unknown>) => createAny('/api/v1/indicators/definitions', body)
export const updateDefinition = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/indicators/definitions/' + id, body)
export const deleteDefinition = (id: number | string) => deleteAny('/api/v1/indicators/definitions/' + id)
export const listDefinitionVersions = (id: number | string) => listAny('/api/v1/indicators/definitions/' + id + '/versions')
export const listInstances = (query = '') => listAny('/api/v1/indicators/instances' + query)
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

// resources
export const listPlatformTypes = () => listAny('/api/v1/observations/platform-types')
export const listSensorTypes = () => listAny('/api/v1/observations/sensor-types')
export const listPlatforms = (query = '') => listAny('/api/v1/observations/platforms' + query)
export const createPlatform = (body: Record<string, unknown>) => createAny('/api/v1/observations/platforms', body)
export const updatePlatform = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/observations/platforms/' + id, body)
export const deletePlatform = (id: number | string) => deleteAny('/api/v1/observations/platforms/' + id)
export const listSensors = (query = '') => listAny('/api/v1/observations/sensors' + query)
export const createSensor = (body: Record<string, unknown>) => createAny('/api/v1/observations/sensors', body)
export const updateSensor = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/observations/sensors/' + id, body)
export const deleteSensor = (id: number | string) => deleteAny('/api/v1/observations/sensors/' + id)
export const getResourceVisualization = (query = '') => getAny('/api/v1/observations/visualization' + query)

// data
export const listDatasets = () => listAny('/api/v1/observations/datasets')
export const createDataset = (body: Record<string, unknown>) => createAny('/api/v1/observations/datasets', body)
export const listObservationData = (query = '') => listAny('/api/v1/observations/data' + query)
export const createObservationData = (body: Record<string, unknown>) => createAny('/api/v1/observations/data', body)
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

// planning
export const listTasks = () => listAny('/api/v1/planning/tasks')
export const getTask = (id: number | string) => getAny('/api/v1/planning/tasks/' + id)
export const createTask = (body: Record<string, unknown>) => createAny('/api/v1/planning/tasks', body)
export const updateTask = (id: number | string, body: Record<string, unknown>) => updateAny('/api/v1/planning/tasks/' + id, body)
export const deleteTask = (id: number | string) => deleteAny('/api/v1/planning/tasks/' + id)
export const submitTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/submit')
export const cancelTask = (id: number | string) => postAction('/api/v1/planning/tasks/' + id + '/cancel')
export const addTaskIndicators = (id: number | string, instanceIds: number[]) =>
  postAction('/api/v1/planning/tasks/' + id + '/add-indicators', { instanceIds })
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
export const getAssociationResult = (planId: number | string) => getAny('/api/v1/association/result/' + planId)
export const archivePlan = (id: number | string) => postAction('/api/v1/association/plans/' + id + '/archive')
export const publishPlan = (id: number | string) => postAction('/api/v1/association/plans/' + id + '/publish')
export const copyPlan = (id: number | string, body: Record<string, unknown> = {}) =>
  postAction('/api/v1/association/plans/' + id + '/copy', body)
export const approvePlan = (id: number | string) => postAction('/api/v1/association/plans/' + id + '/approve')
export const comparePlans = (id: number | string, otherId: number | string) =>
  getAny('/api/v1/association/plans/' + id + '/compare?otherId=' + encodeURIComponent(String(otherId)))

// algorithms
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

// applications
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

// data source lifecycle
export const enableDataSource = (id: number | string) => postAction('/api/v1/observations/data-sources/' + id + '/enable')
export const disableDataSource = (id: number | string) => postAction('/api/v1/observations/data-sources/' + id + '/disable')

// file import pipeline
export const executeFileImport = (id: number | string) => postAction('/api/v1/observations/file-imports/' + id + '/execute')
export const pauseFileImport = (id: number | string) => postAction('/api/v1/observations/file-imports/' + id + '/pause')
export const resumeFileImport = (id: number | string) => postAction('/api/v1/observations/file-imports/' + id + '/resume')
export const retryFileImport = (id: number | string) => postAction('/api/v1/observations/file-imports/' + id + '/retry')

// observation data quality / download
export const qualityCheckData = (id: number | string) => postAction('/api/v1/observations/data/' + id + '/quality-check')
export const quarantineData = (id: number | string) => postAction('/api/v1/observations/data/' + id + '/quarantine')
export const releaseData = (id: number | string) => postAction('/api/v1/observations/data/' + id + '/release')
export const spatialPreviewData = (id: number | string) => getAny('/api/v1/observations/data/' + id + '/spatial-preview')
export const dataProvenance = (id: number | string) => getAny('/api/v1/observations/data/' + id + '/provenance')

// file import upload (multipart)
export async function importObservationFile(form: FormData) {
  return apiEnvelope('/api/v1/observations/file-imports/import-file', {
    method: 'POST',
    body: form,
  })
}

export const downloadImportTemplate = (fileFormat = 'csv') =>
  fetchText('/api/v1/observations/file-imports/template?fileFormat=' + encodeURIComponent(fileFormat))

// instance versions
export const listInstanceVersions = (id: number | string) =>
  listAny('/api/v1/indicators/instances/' + id + '/versions')
export const compareInstanceVersions = (id: number | string, fromV: number | string, toV: number | string) =>
  getAny('/api/v1/indicators/instances/' + id + '/versions/compare?from=' + fromV + '&to=' + toV)
export const rollbackInstanceVersion = (id: number | string, version: number | string) =>
  postAction('/api/v1/indicators/instances/' + id + '/versions/' + version + '/rollback')
