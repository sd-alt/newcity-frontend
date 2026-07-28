import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import HomeView from '../pages/HomeView.vue'
import LoginView from '../pages/LoginView.vue'
import ResourcesCenter from '../pages/ResourcesCenter.vue'
import DataCenter from '../pages/DataCenter.vue'
import PlanningCenter from '../pages/PlanningCenter.vue'
import AlgorithmsCenter from '../pages/AlgorithmsCenter.vue'
import ApplicationsCenter from '../pages/ApplicationsCenter.vue'
import TaskCenterView from '../pages/TaskCenterView.vue'
import SensorMetadataView from '../pages/SensorMetadataView.vue'
import ResourceKnowledgeView from '../pages/ResourceKnowledgeView.vue'
import BusinessExecutionView from '../pages/BusinessExecutionView.vue'
import AgentTaskWorkspace from '../pages/AgentTaskWorkspace.vue'
import { useAuthStore } from '../stores/auth'

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
        { path: 'resources/metadata', name: 'resource-metadata', component: SensorMetadataView, meta: { requiresAuth: true } },
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
