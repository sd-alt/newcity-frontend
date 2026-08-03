import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const AppLayout = () => import('../components/AppLayout.vue')
const HomeView = () => import('../pages/HomeView.vue')
const LoginView = () => import('../pages/LoginView.vue')
const ResourcesCenter = () => import('../pages/ResourcesCenter.vue')
const DataCenter = () => import('../pages/DataCenter.vue')
const PlanningCenter = () => import('../pages/PlanningCenter.vue')
const AlgorithmsCenter = () => import('../pages/AlgorithmsCenter.vue')
const ApplicationsCenter = () => import('../pages/ApplicationsCenter.vue')
const TaskCenterView = () => import('../pages/TaskCenterView.vue')
const ResourceKnowledgeView = () => import('../pages/ResourceKnowledgeView.vue')
const BusinessExecutionView = () => import('../pages/BusinessExecutionView.vue')
const AgentTaskWorkspace = () => import('../pages/AgentTaskWorkspace.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', name: 'home', component: HomeView, meta: { requiresAuth: true } },
        { path: 'tasks', name: 'task-center', component: TaskCenterView, meta: { requiresAuth: true } },
        { path: 'resources/sensors', name: 'resource-sensors', component: ResourcesCenter, meta: { requiresAuth: true } },
        {
          path: 'resources/metadata',
          redirect: (to) => ({
            name: 'resource-sensors',
            query: { ...to.query, tab: 'crud' },
          }),
        },
        { path: 'resources/data', name: 'resource-data', component: DataCenter, meta: { requiresAuth: true } },
        { path: 'resources/algorithms', name: 'resource-algorithms', component: AlgorithmsCenter, meta: { requiresAuth: true } },
        { path: 'resources/knowledge', name: 'resource-knowledge', component: ResourceKnowledgeView, meta: { requiresAuth: true } },
        { path: 'business', name: 'business-center', component: PlanningCenter, meta: { requiresAuth: true } },
        { path: 'business/execution', name: 'business-execution', component: BusinessExecutionView, meta: { requiresAuth: true } },
        { path: 'application', name: 'application-center', component: ApplicationsCenter, meta: { requiresAuth: true } },
        { path: 'application/tasks', name: 'application-agent-tasks', component: AgentTaskWorkspace, meta: { requiresAuth: true } },
        { path: 'indicators', redirect: { name: 'task-center' } },
        { path: 'resources', redirect: { name: 'resource-sensors' } },
        { path: 'data', redirect: { name: 'resource-data' } },
        { path: 'planning', redirect: { name: 'business-center' } },
        { path: 'algorithms', redirect: { name: 'resource-algorithms' } },
        { path: 'applications', redirect: { name: 'application-center' } },
        {
          path: 'gis',
          name: 'gis',
          redirect: (to) => ({
            name: 'application-center',
            query: {
              ...to.query,
              tab: typeof to.query.tab === 'string' ? to.query.tab : 'gis',
            },
          }),
        },
      ],
    },
  ],
})

let bootstrapped = false
window.addEventListener('newcity:auth-expired', () => {
  const auth = useAuthStore()
  auth.user.value = null
  if (router.currentRoute.value.name !== 'login') {
    router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
  }
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (bootstrapped === false) {
    bootstrapped = true
    await auth.refresh()
  }
  if (to.meta.public) {
    if (auth.user.value && to.name === 'login') return { name: 'home' }
    return true
  }
  if (to.meta.requiresAuth && auth.user.value == null) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
