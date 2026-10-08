<script setup lang="ts">
import { CheckSquare } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type DueGroup, type Meta, type Project, type Task } from '../api'
import TaskItem from '../components/TaskItem.vue'
import { useAutoRefresh, useErrors } from '../composables'
import { TASK_PRIORITIES } from '../tasks'
import PageHeader from '../ui/PageHeader.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiEmpty from '../ui/UiEmpty.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { error, report } = useErrors()

const tasks = ref<Task[]>([])
const projects = ref<Project[]>([])
const meta = ref<Meta | null>(null)
const loaded = ref(false)
const draft = ref('')
const draftProject = ref('')

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const filters = computed(() => ({
  project: q('project'),
  client: q('client'),
  category: q('category'),
  priority: q('priority'),
  show: q('show') || 'open',
}))
function setFilter(key: string, value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined } })
}

const STATUS_BY_SHOW: Record<string, string> = { open: 'todo,in_progress', done: 'done', all: 'todo,in_progress,done' }

let latest = 0
async function load() {
  const request = ++latest
  try {
    const f = filters.value
    const [list, m, p] = await Promise.all([
      api.tasks({
        project: f.project || undefined,
        client: f.client || undefined,
        category: f.category || undefined,
        priority: f.priority || undefined,
        status: STATUS_BY_SHOW[f.show] ?? STATUS_BY_SHOW.open,
      }),
      api.meta(),
      api.projects({}),
    ])
    if (request !== latest) return
    tasks.value = list
    meta.value = m
    projects.value = p
    error.value = null
  } catch (e) {
    report(e)
  } finally {
    loaded.value = true
  }
}

const GROUPS: DueGroup[] = ['overdue', 'today', 'week', 'later', 'none']
const groups = computed(() => {
  const open = tasks.value.filter((x) => x.status !== 'done')
  return GROUPS.map((g) => ({ id: g, tasks: open.filter((x) => x.dueGroup === g) })).filter((g) => g.tasks.length)
})
const completed = computed(() =>
  tasks.value.filter((x) => x.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
)

async function add() {
  const title = draft.value.trim()
  const projectId = draftProject.value || filters.value.project
  if (!title || !projectId) return
  try {
    await api.createTask(projectId, { title })
    draft.value = ''
    await load()
  } catch (e) {
    report(e)
  }
}

function replace(task: Task) {
  tasks.value = tasks.value.map((x) => (x.id === task.id ? task : x))
}
function drop(id: string) {
  tasks.value = tasks.value.filter((x) => x.id !== id)
}

watch(() => route.query, load)
useAutoRefresh(load)
</script>

<template>
  <section>
    <PageHeader :title="t('app.tasks')" :subtitle="t('task.count', { n: tasks.length }, tasks.length)" />

    <form class="mb-4 grid gap-2 sm:grid-cols-[1fr_16rem_auto]" @submit.prevent="add">
      <input v-model="draft" class="field" maxlength="500" :placeholder="t('task.add')" :aria-label="t('task.add')" />
      <select v-model="draftProject" class="field" :aria-label="t('task.addTo')" :required="!filters.project">
        <option value="">{{ filters.project ? projects.find((p) => p.id === filters.project)?.name : t('task.pickProject') }}</option>
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <button class="btn btn-primary" :disabled="!draft.trim() || !(draftProject || filters.project)">{{ t('settings.add') }}</button>
    </form>

    <div class="mb-6 grid gap-2 sm:grid-cols-5">
      <select class="field" :value="filters.show" :aria-label="t('a11y.show')" @change="setFilter('show', ($event.target as HTMLSelectElement).value === 'open' ? '' : ($event.target as HTMLSelectElement).value)">
        <option value="open">{{ t('task.openOnly') }}</option>
        <option value="done">{{ t('task.doneOnly') }}</option>
        <option value="all">{{ t('task.allTasks') }}</option>
      </select>
      <select class="field" :value="filters.project" :aria-label="t('a11y.project')" @change="setFilter('project', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('task.anyProject') }}</option>
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select class="field" :value="filters.client" :aria-label="t('a11y.client')" @change="setFilter('client', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyClient') }}</option>
        <option value="none">{{ t('list.noClient') }}</option>
        <option v-for="c in meta?.clients" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <select class="field" :value="filters.category" :aria-label="t('a11y.category')" @change="setFilter('category', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyCategory') }}</option>
        <option value="none">{{ t('list.noCategory') }}</option>
        <option v-for="c in meta?.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <select class="field" :value="filters.priority" :aria-label="t('a11y.priority')" @change="setFilter('priority', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('task.anyPriority') }}</option>
        <option v-for="p in TASK_PRIORITIES" :key="p" :value="p">{{ t(`task.priority.${p}`) }}</option>
      </select>
    </div>

    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <div v-for="group in groups" :key="group.id" class="mb-8">
      <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold" :class="{ 'text-danger': group.id === 'overdue' }">
        {{ t(`task.due.${group.id}`) }}
        <UiBadge :tone="group.id === 'overdue' ? 'danger' : 'neutral'">{{ group.tasks.length }}</UiBadge>
      </h2>
      <div class="card divide-y divide-line px-4">
        <TaskItem v-for="task in group.tasks" :key="task.id" :task="task" show-project @changed="replace" @removed="drop" />
      </div>
    </div>

    <div v-if="completed.length" class="mb-8">
      <h2 class="mb-2 text-sm font-semibold text-muted">{{ t('task.status.done') }}</h2>
      <div class="card divide-y divide-line px-4">
        <TaskItem v-for="task in completed" :key="task.id" :task="task" show-project @changed="replace" @removed="drop" />
      </div>
    </div>

    <UiEmpty v-if="loaded && !error && tasks.length === 0" :icon="CheckSquare" :title="t('task.emptyTitle')" :hint="t('task.emptyHint')" />
  </section>
</template>
