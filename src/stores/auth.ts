import { computed, ref } from 'vue'
import * as api from '../api/endpoints'
import type { UserInfo } from '../api/types'

const user = ref<UserInfo | null>(null)
const loading = ref(true)
const lastTaskId = ref<number | null>(null)

export function useAuthStore() {
  const isAuthenticated = computed(() => !!user.value)

  async function refresh() {
    loading.value = true
    try {
      await api.ensureCsrf()
      const res = await api.getMe()
      user.value = res.data
    } catch {
      user.value = null
    } finally {
      loading.value = false
    }
  }

  async function login(username: string, password: string) {
    const res = await api.login(username, password)
    user.value = res.data
  }

  async function logout() {
    try {
      await api.logout()
    } finally {
      user.value = null
    }
  }

  function setLastTaskId(id: number | null) {
    lastTaskId.value = id
  }

  return {
    user,
    loading,
    isAuthenticated,
    lastTaskId,
    refresh,
    login,
    logout,
    setLastTaskId,
  }
}
