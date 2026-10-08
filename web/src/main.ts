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

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'projects', component: ProjectsView },
    { path: '/projects/:id', name: 'project', component: ProjectDetailView, props: true },
    { path: '/tasks', name: 'tasks', component: TasksView },
    { path: '/clients', name: 'clients', component: ClientsView },
    { path: '/clients/:id', name: 'client', component: ClientDetailView, props: true },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
})

createApp(App).use(router).use(i18n).mount('#app')
