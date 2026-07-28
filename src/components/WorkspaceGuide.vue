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
  { key: 'application', phase: '发起', center: '应用中心', question: '要解决什么场景问题？', outcome: '形成可跟踪的监测需求', to: '/application/tasks', matches: ['/application'], steps: ['选择手动、AI 辅助或多 Agent', '描述对象、区域、时间和成果要求', '在地图绘制任务范围并启动'] },
  { key: 'tasks', phase: '定义', center: '任务中心', question: '具体需要监测什么？', outcome: '形成正式任务指标体系', to: '/tasks', matches: ['/tasks'], steps: ['选择或建立基础指标体系', '把需求拆成具体观测指标', '绑定任务草案并人工确认'] },
  { key: 'resources', phase: '准备', center: '资源中心', question: '哪些资源和数据可以使用？', outcome: '形成可检索的资源能力档案', to: '/resources/sensors', matches: ['/resources'], steps: ['登记传感平台与传感器', '补齐能力、位置和服务档案', '核对数据、算法与在线状态'] },
  { key: 'business', phase: '规划', center: '业务中心', question: '怎样组成可执行方案？', outcome: '输出经评估的观测方案', to: '/business', matches: ['/business'], steps: ['选择任务并反算资源需求', '完成候选评分、关联和增补', '核对覆盖后发布、执行并回看成果'] },
]

const current = computed<JourneyItem>(() => journey.find((item) => item.matches.some((prefix) => route.path.startsWith(prefix))) ?? journey[0]!)

onMounted(() => {
  try { open.value = window.localStorage.getItem('newcity-workspace-guide') !== 'hidden' } catch { open.value = true }
})

function hide() {
  open.value = false
  try { window.localStorage.setItem('newcity-workspace-guide', 'hidden') } catch { /* storage may be unavailable */ }
}

function show() {
  open.value = true
  try { window.localStorage.removeItem('newcity-workspace-guide') } catch { /* storage may be unavailable */ }
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
        <div><span>监测任务闭环</span><strong>一项任务怎样走完整个系统</strong></div>
        <button type="button" @click="hide">隐藏</button>
      </header>
      <nav aria-label="四中心任务路线">
        <button v-for="item in journey" :key="item.key" type="button" :class="{ active: current.key === item.key }" @click="go(item)">
          <i>{{ item.phase }}</i><span><strong>{{ item.center }}</strong><small>{{ item.question }}</small></span>
        </button>
      </nav>
      <article>
        <p>{{ current.phase }}阶段 · {{ current.outcome }}</p>
        <strong>{{ current.question }}</strong>
        <ol><li v-for="step in current.steps" :key="step">{{ step }}</li></ol>
        <button type="button" class="guide-go" @click="go(current)">进入{{ current.center }}</button>
      </article>
      <footer>方案执行和成果会回到应用中心，形成下一轮监测依据。</footer>
    </section>
  </div>
</template>

<style scoped>
.workspace-guide-root { position: relative; }
.workspace-guide-trigger { display: inline-flex; align-items: center; gap: .35rem; height: 36px; padding: 0 .55rem; border: 1px solid #c8d7d4; border-radius: 6px; background: #f7faf9; color: #315e5a; cursor: pointer; }
.workspace-guide-trigger span { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #dfecea; color: #0d756b; font-weight: 700; }
.workspace-guide-trigger strong { font-size: 11px; white-space: nowrap; }
.workspace-guide-panel { position: absolute; z-index: 1200; top: calc(100% + 10px); right: 0; width: min(360px, calc(100vw - 24px)); max-height: calc(100vh - 80px); overflow: auto; padding: .8rem; border: 1px solid #b9cbc7; border-top: 4px solid #287b78; background: #f7faf9; box-shadow: 0 16px 40px rgba(19, 48, 52, .22); color: #294b48; }
.workspace-guide-panel header { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; }
.workspace-guide-panel header div { display: grid; gap: .12rem; }
.workspace-guide-panel header span { color: #98651c; font-size: 9px; letter-spacing: .09em; }
.workspace-guide-panel header strong { color: #173f43; font-size: 14px; }
.workspace-guide-panel header button { border: 0; background: transparent; color: #667b77; font-size: 10px; cursor: pointer; }
.workspace-guide-panel nav { position: relative; display: grid; gap: .25rem; margin: .7rem 0; }
.workspace-guide-panel nav::before { content: ''; position: absolute; left: 1.05rem; top: 1rem; bottom: 1rem; width: 1px; background: #b9cbc7; }
.workspace-guide-panel nav button { position: relative; display: grid; grid-template-columns: 2.1rem 1fr; gap: .45rem; align-items: center; padding: .42rem; border: 1px solid transparent; background: transparent; text-align: left; cursor: pointer; }
.workspace-guide-panel nav button.active { border-color: #a9c7c1; background: #eaf4f2; }
.workspace-guide-panel nav i { z-index: 1; display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid #94b4ae; border-radius: 50%; background: #f7faf9; color: #176e66; font-size: 9px; font-style: normal; }
.workspace-guide-panel nav button.active i { background: #287b78; color: #fff; border-color: #287b78; }
.workspace-guide-panel nav span { display: grid; gap: .05rem; }
.workspace-guide-panel nav strong { font-size: 11px; }
.workspace-guide-panel nav small { color: #6d7f7c; font-size: 9px; }
.workspace-guide-panel article { padding: .65rem; border-left: 3px solid #b27a21; background: #fff; }
.workspace-guide-panel article p { margin: 0 0 .2rem; color: #8a682a; font-size: 9px; }
.workspace-guide-panel article > strong { color: #173f43; font-size: 12px; }
.workspace-guide-panel ol { display: grid; gap: .2rem; margin: .45rem 0; padding-left: 1.2rem; color: #536966; font-size: 10px; line-height: 1.45; }
.guide-go { width: 100%; padding: .4rem; border: 0; background: #0d756b; color: #fff; font-size: 11px; cursor: pointer; }
.workspace-guide-panel footer { margin-top: .55rem; color: #6d7f7c; font-size: 9px; line-height: 1.45; }
@media (max-width: 1050px) { .workspace-guide-trigger strong { display: none; } .workspace-guide-trigger { width: 36px; justify-content: center; padding: 0; } }
</style>
