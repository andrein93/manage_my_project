import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { i18n } from './i18n'
import './style.css'
import ClientDetailView from './views/ClientDetailView.vue'
import ClientsView from './views/ClientsView.vue'
import ProjectDetailView from './views/ProjectDetailView.vue'
import ProjectsView from './views/ProjectsView.vue'
import SettingsView from './views/SettingsView.vue'
import TasksView from './views/TasksView.vue'
import FinanceView from './views/FinanceView.vue'
import StatementPrintView from './views/StatementPrintView.vue'
import StatementView from './views/StatementView.vue'
import OverviewView from './views/OverviewView.vue'
import TimeView from './views/TimeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: OverviewView },
    { path: '/projects', name: 'projects', component: ProjectsView },
    { path: '/projects/:id', name: 'project', component: ProjectDetailView, props: true },
    { path: '/tasks', name: 'tasks', component: TasksView },
    { path: '/time', name: 'time', component: TimeView },
    { path: '/finance', name: 'finance', component: FinanceView },
    { path: '/clients', name: 'clients', component: ClientsView },
    { path: '/clients/:id', name: 'client', component: ClientDetailView, props: true },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/statements/:id', name: 'statement', component: StatementView, props: true },
    // A document to print: no sidebar, toasts or palette (see App.vue), always light.
    { path: '/statements/:id/print', name: 'statement-print', component: StatementPrintView, props: true, meta: { bare: true } },
  ],
})

const app = createApp(App).use(router).use(i18n)
// Mount once the first route is resolved, so the page transition doesn't animate out of an empty view.
router.isReady().then(() => app.mount('#app'))
