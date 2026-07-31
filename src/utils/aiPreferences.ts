export type AiTaskMode = 'manual' | 'assisted' | 'agent'

export type AiPreferences = {
  defaultTaskMode: AiTaskMode
  showTechnicalDetails: boolean
}

const STORAGE_KEY = 'newcity-ai-preferences'
export const AI_PREFERENCES_EVENT = 'newcity-ai-preferences-changed'

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  defaultTaskMode: 'agent',
  showTechnicalDetails: false,
}

export function readAiPreferences(): AiPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<AiPreferences>
    return {
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
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* storage may be unavailable */ }
  window.dispatchEvent(new CustomEvent(AI_PREFERENCES_EVENT))
}
