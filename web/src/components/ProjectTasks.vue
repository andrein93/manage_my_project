<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Task, type TaskStatus } from '../api'
import { useAutoRefresh, useErrors } from '../composables'
import { positionAt, priorityClass, shortDate, TASK_STATUSES } from '../tasks'
import TaskItem from './TaskItem.vue'

const props = defineProps<{ projectId: string }>()
const { t } = useI18n()
const { error, report } = useErrors()

const tasks = ref<Task[]>([])
const draft = ref('')
const showDone = ref(false)
const mode = ref<'list' | 'board'>(readMode())

function readMode(): 'list' | 'board' {
  try {
    return localStorage.getItem('mmp.tasks.mode') === 'board' ? 'board' : 'list'
  } catch {
    return 'list'
  }
}
watch(mode, (m) => {
  try {
    localStorage.setItem('mmp.tasks.mode', m)
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
})

let latest = 0
async function load() {
  const request = ++latest
  try {
    const list = await api.tasks({ project: props.projectId, status: TASK_STATUSES.join(',') })
    if (request === latest) tasks.value = list
  } catch (e) {
    report(e)
  }
}

const open = computed(() => tasks.value.filter((x) => x.status !== 'done'))
const done = computed(() => tasks.value.filter((x) => x.status === 'done'))
const columns = computed(() =>
  Object.fromEntries(
    TASK_STATUSES.map((s) => [s, tasks.value.filter((x) => x.status === s).sort((a, b) => a.position - b.position)]),
  ) as Record<TaskStatus, Task[]>,
)

async function add() {
  const title = draft.value.trim()
  if (!title) return
  try {
    await api.createTask(props.projectId, { title })
    draft.value = ''
    error.value = null
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

async function move(task: Task, status: TaskStatus, index?: number) {
  const column = columns.value[status].filter((x) => x.id !== task.id)
  const position = positionAt(column, index ?? column.length)
  try {
    replace(await api.updateTask(task.id, { status, position }))
  } catch (e) {
    report(e)
  }
}

// Drag and drop between and within board columns.
const dragging = ref<Task | null>(null)
const over = ref<TaskStatus | null>(null)
function onDrop(status: TaskStatus, index?: number) {
  const task = dragging.value
  dragging.value = null
  over.value = null
  if (task) move(task, status, index)
}

watch(() => props.projectId, load)
useAutoRefresh(load)
</script>

<template>
  <section>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">{{ t('app.tasks') }}</h2>
      <div class="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-sm" role="group">
        <button
          v-for="m in ['list', 'board'] as const"
          :key="m"
          type="button"
          class="rounded-md px-3 py-1 transition-colors"
          :class="mode === m ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
          :aria-pressed="mode === m"
          @click="mode = m"
        >
          {{ t(`task.${m}`) }}
        </button>
      </div>
    </div>

    <form @submit.prevent="add">
      <input v-model="draft" class="field" maxlength="500" :placeholder="t('task.add')" :aria-label="t('task.add')" />
    </form>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>

    <!-- List -->
    <div v-if="mode === 'list'" class="mt-3">
      <p v-if="tasks.length === 0" class="py-6 text-sm text-muted">{{ t('task.empty') }}</p>
      <div class="divide-y divide-line">
        <TaskItem v-for="task in open" :key="task.id" :task="task" @changed="replace" @removed="drop" />
      </div>
      <button v-if="done.length" type="button" class="mt-3 text-sm text-muted hover:text-ink" @click="showDone = !showDone">
        {{ showDone ? t('task.hideDone') : t('task.showDone', { n: done.length }) }}
      </button>
      <div v-if="showDone" class="mt-1 divide-y divide-line">
        <TaskItem v-for="task in done" :key="task.id" :task="task" @changed="replace" @removed="drop" />
      </div>
    </div>

    <!-- Board -->
    <div v-else class="mt-4 grid gap-4 md:grid-cols-3">
      <div
        v-for="status in TASK_STATUSES"
        :key="status"
        class="flex min-h-40 flex-col rounded-lg border border-line bg-surface-2/50 p-2 transition-colors"
        :class="{ '!border-action': over === status }"
        @dragover.prevent="over = status"
        @dragleave.self="over = null"
        @drop.prevent="onDrop(status)"
      >
        <h3 class="flex items-center justify-between px-1.5 pt-1 pb-2 text-sm font-medium">
          {{ t(`task.status.${status}`) }}
          <span class="text-xs font-normal text-muted tabular-nums">{{ columns[status].length }}</span>
        </h3>
        <ul class="flex flex-1 flex-col gap-2">
          <li
            v-for="(task, index) in columns[status]"
            :key="task.id"
            draggable="true"
            class="cursor-grab rounded-md border border-line bg-surface p-2.5 text-sm shadow-card transition-shadow hover:border-line-strong active:cursor-grabbing"
            :class="{ 'opacity-40': dragging?.id === task.id }"
            @dragstart="dragging = task"
            @dragend="dragging = null; over = null"
            @dragover.prevent.stop="over = status"
            @drop.prevent.stop="onDrop(status, index)"
          >
            <p class="break-words" :class="{ 'text-muted line-through': status === 'done' }">{{ task.title }}</p>
            <div class="mt-2 flex items-center justify-between gap-2 text-xs">
              <span class="flex gap-2">
                <span v-if="task.priority !== 'normal'" :class="priorityClass[task.priority]">{{ t(`task.priority.${task.priority}`) }}</span>
                <span v-if="task.dueDate" :class="task.dueGroup === 'overdue' ? 'text-danger' : 'text-muted'">
                  {{ task.dueGroup === 'today' ? t('task.dueToday') : shortDate(task.dueDate) }}
                </span>
              </span>
              <select
                class="select-fit cursor-pointer bg-transparent text-muted"
                :value="status"
                :aria-label="`${t('task.moveTo')}: ${task.title}`"
                @change="move(task, ($event.target as HTMLSelectElement).value as TaskStatus)"
              >
                <option v-for="s in TASK_STATUSES" :key="s" :value="s">{{ t(`task.status.${s}`) }}</option>
              </select>
            </div>
          </li>
        </ul>
        <p v-if="columns[status].length === 0" class="px-1.5 py-4 text-center text-xs text-muted">{{ t('task.emptyColumn') }}</p>
      </div>
    </div>
  </section>
</template>
