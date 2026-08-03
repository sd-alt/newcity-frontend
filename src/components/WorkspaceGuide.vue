<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

type JourneyItem = {
  key: string
  phase: string
  center: string
  question: string
  outcome: string
  to: string
  matches: string[]
  steps: string[]
}

const route = useRoute()
const router = useRouter()
const open = ref(false)

const journey: JourneyItem[] = [
  { key: 'application', phase: '需求', center: '应用中心', question: '要解决什么场景问题？', outcome: '填写监测需求', to: '/application/tasks', matches: ['/application'], steps: ['选择手动、AI 辅助或多 Agent', '描述对象、区域、时间和成果要求', '在地图绘制任务范围并启动'] },
  { key: 'tasks', phase: '任务', center: '任务中心', question: '先把任务和指标说清楚？', outcome: '创建任务并配置指标', to: '/tasks?tab=task-create', matches: ['/tasks'], steps: ['创建任务并填写观测目标', '建立或选择指标体系', '提交任务后进入资源配置'] },
  { key: 'resources', phase: '资源', center: '资源中心', question: '哪些资源和数据可以使用？', outcome: '检查资源与数据能力', to: '/resources/sensors?tab=capabilities', matches: ['/resources'], steps: ['登记传感器资源', '维护观测能力、位置和状态', '配置数据接入、算法服务和知识'] },
  { key: 'business', phase: '配置', center: '业务中心', question: '怎样选择资源并完成配置？', outcome: '选择资源并完成配置', to: '/business?tab=candidates', matches: ['/business'], steps: ['查询并选中任务需求', '选择候选资源并查看能力评估', '完成资源配置后查看方案与成果'] },
]

const current = computed<JourneyItem>(() => journey.find((item) => item.matches.some((prefix) => route.path.startsWith(prefix))) ?? journey[0]!)

onMounted(() => {
  try { open.value = window.localStorage.getItem('newcity-workspace-guide') !== 'hidden' } catch { open.value = true }
})

function hide() {
  open.value = false
  try { window.localStorage.setItem('newcity-workspace-guide', 'hidden') } catch { /* 当前环境可能无法使用本地存储 */ }
}

function show() {
  open.value = true
  try { window.localStorage.removeItem('newcity-workspace-guide') } catch { /* 当前环境可能无法使用本地存储 */ }
}

async function go(item: JourneyItem) {
  await router.push(item.to)
}
</script>

<template>
  <div class="workspace-guide-root">
    <button type="button" class="workspace-guide-trigger" :aria-label="open ? '隐藏使用引导' : '打开使用引导'" :aria-expanded="open" @click="open ? hide() : show()">
      <span aria-hidden="true">?</span><strong>使用引导</strong>
    </button>
    <section v-if="open" class="workspace-guide-panel" aria-label="四中心使用引导">
      <header>
        <div><span>使用提示</span><strong>不知道从哪里开始？按下面顺序操作</strong></div>
        <button type="button" @click="hide">隐藏</button>
      </header>
      <nav aria-label="四中心任务路线">
        <button v-for="item in journey" :key="item.key" type="button" :class="{ active: current.key === item.key }" @click="go(item)">
          <i>{{ item.phase }}</i><span><strong>{{ item.center }}</strong><small>{{ item.question }}</small></span>
        </button>
      </nav>
      <article>
        <p>{{ current.center }} · {{ current.outcome }}</p>
        <strong>{{ current.question }}</strong>
        <ol><li v-for="step in current.steps" :key="step">{{ step }}</li></ol>
        <button type="button" class="guide-go" @click="go(current)">进入{{ current.center }}</button>
      </article>
      <footer>任务完成后，可在应用中心查看地图和统计结果。</footer>
    </section>
  </div>
</template>

<style scoped>
.workspace-guide-root { position: relative; }
.workspace-guide-trigger { display: inline-flex; align-items: center; gap: .35rem; height: 36px; padding: 0 .65rem; border: 1px solid #e5e5ea; border-radius: 12px; background: #fff; color: #515154; cursor: pointer; }
.workspace-guide-trigger span { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #f0f7ff; color: #0071e3; font-weight: 700; }
.workspace-guide-trigger strong { font-size: 11px; white-space: nowrap; }
.workspace-guide-panel { position: absolute; z-index: 1200; top: calc(100% + 10px); right: 0; width: min(360px, calc(100vw - 24px)); max-height: calc(100vh - 80px); overflow: auto; padding: .9rem; border: 1px solid #e5e5ea; border-radius: 18px; background: #fff; box-shadow: 0 12px 32px rgba(29, 29, 31, .11); color: #1d1d1f; }
.workspace-guide-panel header { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; }
.workspace-guide-panel header div { display: grid; gap: .12rem; }
.workspace-guide-panel header span { color: #98651c; font-size: 9px; letter-spacing: .09em; }
.workspace-guide-panel header strong { color: #1d1d1f; font-size: 14px; }
.workspace-guide-panel header button { border: 0; background: transparent; color: #86868b; font-size: 10px; cursor: pointer; }
.workspace-guide-panel nav { position: relative; display: grid; gap: .25rem; margin: .7rem 0; }
.workspace-guide-panel nav::before { content: ''; position: absolute; left: 1.05rem; top: 1rem; bottom: 1rem; width: 1px; background: #d2d2d7; }
.workspace-guide-panel nav button { position: relative; display: grid; grid-template-columns: 2.1rem 1fr; gap: .45rem; align-items: center; padding: .48rem; border: 1px solid transparent; border-radius: 10px; background: transparent; text-align: left; cursor: pointer; }
.workspace-guide-panel nav button.active { border-color: #b7d7f7; background: #f0f7ff; }
.workspace-guide-panel nav i { z-index: 1; display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid #b7d7f7; border-radius: 50%; background: #fff; color: #0071e3; font-size: 9px; font-style: normal; }
.workspace-guide-panel nav button.active i { background: #0071e3; color: #fff; border-color: #0071e3; }
.workspace-guide-panel nav span { display: grid; gap: .05rem; }
.workspace-guide-panel nav strong { font-size: 11px; }
.workspace-guide-panel nav small { color: #86868b; font-size: 9px; }
.workspace-guide-panel article { padding: .7rem; border: 1px solid #e7dfca; border-radius: 10px; background: #fffbf1; }
.workspace-guide-panel article p { margin: 0 0 .2rem; color: #8a682a; font-size: 9px; }
.workspace-guide-panel article > strong { color: #1d1d1f; font-size: 12px; }
.workspace-guide-panel ol { display: grid; gap: .2rem; margin: .45rem 0; padding-left: 1.2rem; color: #515154; font-size: 10px; line-height: 1.45; }
.guide-go { width: 100%; padding: .5rem; border: 0; border-radius: 10px; background: #0071e3; color: #fff; font-size: 11px; cursor: pointer; }
.workspace-guide-panel footer { margin-top: .55rem; color: #86868b; font-size: 9px; line-height: 1.45; }
@media (max-width: 1050px) { .workspace-guide-trigger strong { display: none; } .workspace-guide-trigger { width: 36px; justify-content: center; padding: 0; } }
</style>
