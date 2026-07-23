<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'

const { login } = useAuthStore()
const router = useRouter()
const route = useRoute()
const username = ref('demo')
const password = ref('demo-pass')
const error = ref<string | null>(null)
const pending = ref(false)

async function onSubmit() {
  pending.value = true
  error.value = null
  try {
    await login(username.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect || '/')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '登录失败'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="panel narrow login-card">
      <p class="eyebrow">地学传感网智能感知服务系统</p>
      <h1>登录 GIS 工作台</h1>
      <p class="muted">演示账号：demo / demo-pass（后端需执行 seed_demo_storyline）</p>
      <form class="form" @submit.prevent="onSubmit">
        <label>
          用户名
          <input v-model="username" autocomplete="username" />
        </label>
        <label>
          密码
          <input v-model="password" type="password" autocomplete="current-password" />
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="btn block" type="submit" :disabled="pending">
          {{ pending ? '登录中…' : '进入系统' }}
        </button>
      </form>
    </section>
  </div>
</template>
