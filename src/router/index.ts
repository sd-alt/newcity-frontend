import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import HomeView from '../pages/HomeView.vue'
import LoginView from '../pages/LoginView.vue'
import IndicatorsCenter from '../pages/IndicatorsCenter.vue'
import ResourcesCenter from '../pages/ResourcesCenter.vue'
import DataCenter from '../pages/DataCenter.vue'
import PlanningCenter from '../pages/PlanningCenter.vue'
import AlgorithmsCenter from '../pages/AlgorithmsCenter.vue'
import ApplicationsCenter from '../pages/ApplicationsCenter.vue'
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
        { path: 'indicators', name: 'indicators', component: IndicatorsCenter, meta: { requiresAuth: true } },
        { path: 'resources', name: 'resources', component: ResourcesCenter, meta: { requiresAuth: true } },
        { path: 'data', name: 'data', component: DataCenter, meta: { requiresAuth: true } },
        { path: 'planning', name: 'planning', component: PlanningCenter, meta: { requiresAuth: true } },
        { path: 'algorithms', name: 'algorithms', component: AlgorithmsCenter, meta: { requiresAuth: true } },
        { path: 'applications', name: 'applications', component: ApplicationsCenter, meta: { requiresAuth: true } },
        { path: 'gis', name: 'gis', redirect: { name: 'applications', query: { tab: 'gis' } } },
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
