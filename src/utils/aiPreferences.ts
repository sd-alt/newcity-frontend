export type AiTaskMode = 'manual' | 'assisted' | 'agent'
export type AiServiceMode = 'preset' | 'api'

export type AiPreferences = {
  serviceMode: AiServiceMode
  apiBase: string
  model: string
  defaultTaskMode: AiTaskMode
  showTechnicalDetails: boolean
}

const STORAGE_KEY = 'newcity-ai-preferences'
export const AI_PREFERENCES_EVENT = 'newcity-ai-preferences-changed'

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  serviceMode: 'api',
  apiBase: '',
  model: '',
  defaultTaskMode: 'agent',
  showTechnicalDetails: false,
}

export function readAiPreferences(): AiPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<AiPreferences>
    return {
      serviceMode: ['preset', 'api'].includes(String(stored.serviceMode))
        ? stored.serviceMode as AiServiceMode
        : DEFAULT_AI_PREFERENCES.serviceMode,
      apiBase: typeof stored.apiBase === 'string' ? stored.apiBase : DEFAULT_AI_PREFERENCES.apiBase,
      model: typeof stored.model === 'string' ? stored.model : DEFAULT_AI_PREFERENCES.model,
      defaultTaskMode: ['manual', 'assisted', 'agent'].includes(String(stored.defaultTaskMode))
        ? stored.defaultTaskMode as AiTaskMode
        : DEFAULT_AI_PREFERENCES.defaultTaskMode,
      showTechnicalDetails: stored.showTechnicalDetails === true,
    }
  } catch {
    return { ...DEFAULT_AI_PREFERENCES }
  }
}

export function saveAiPreferences(value: AiPreferences) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* 当前环境可能无法使用本地存储 */ }
  window.dispatchEvent(new CustomEvent(AI_PREFERENCES_EVENT))
}
