<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'

const { login } = useAuthStore()
const router = useRouter()
const route = useRoute()
const username = ref(import.meta.env.DEV ? 'demo' : '')
const password = ref(import.meta.env.DEV ? 'demo-pass' : '')
const isDev = import.meta.env.DEV
const error = ref<string | null>(null)
const pending = ref(false)

async function onSubmit() {
  pending.value = true
  error.value = null
  try {
    await login(username.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    // 先结束“登录中”，避免底图/路由挂载拖住按钮状态
    pending.value = false
    await router.replace(redirect || '/')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '登录失败'
    pending.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-shell">
      <aside class="login-brand" aria-hidden="true">
        <div class="login-brand-inner">
          <span class="login-logo"></span>
          <h2>地学传感网<br />智能感知服务系统</h2>
          <p>指标 · 资源 · 数据 · 规划 · 算法 · 应用</p>
          <ul class="login-points">
            <li>一张地图承载全业务链路</li>
            <li>自然语言下达观测任务</li>
            <li>多源传感资源智能调度</li>
          </ul>
        </div>
      </aside>
      <div class="panel login-card">
        <p class="eyebrow">欢迎回来</p>
        <h1>登录 GIS 工作台</h1>
        <p v-if="isDev" class="muted">演示账号：demo / demo-pass（后端需执行 seed_demo_storyline）</p>
        <form class="form" @submit.prevent="onSubmit">
          <label>
            用户名
            <input v-model="username" type="text" name="username" autocomplete="username" placeholder="请输入用户名" />
          </label>
          <label>
            密码
            <input v-model="password" type="password" name="password" autocomplete="current-password" placeholder="请输入密码" />
          </label>
          <p v-if="error" class="error">{{ error }}</p>
          <button class="btn block" type="submit" :disabled="pending">
            {{ pending ? '登录中…' : '进入系统' }}
          </button>
        </form>
      </div>
    </section>
  </div>
</template>