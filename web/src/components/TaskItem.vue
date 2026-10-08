<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Task, type TaskInput } from '../api'
import { useErrors } from '../composables'
import { priorityClass, shortDate, TASK_PRIORITIES } from '../tasks'
import CategoryDot from './CategoryDot.vue'

const props = defineProps<{ task: Task; showProject?: boolean }>()
const emit = defineEmits<{ changed: [task: Task]; removed: [id: string] }>()
const { t } = useI18n()
const { error, report } = useErrors()

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)
const dateInput = ref<HTMLInputElement | null>(null)
const confirmDelete = ref(false)
/** Bumped after a failed save: re-creates the controls so they show the task's real values. */
const renderKey = ref(0)

async function save(patch: TaskInput) {
  try {
    emit('changed', await api.updateTask(props.task.id, patch))
    error.value = null
  } catch (e) {
    report(e)
    renderKey.value++
  }
}

async function startEdit() {
  draft.value = props.task.title
  editing.value = true
  await nextTick()
  input.value?.select()
}

async function commitEdit() {
  if (!editing.value) return
  editing.value = false
  const title = draft.value.trim()
  if (title && title !== props.task.title) await save({ title })
}

async function remove() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    setTimeout(() => (confirmDelete.value = false), 3000)
    return
  }
  try {
    await api.removeTask(props.task.id)
    emit('removed', props.task.id)
  } catch (e) {
    report(e)
  }
}

const done = () => props.task.status === 'done'
</script>

<template>
  <div :key="renderKey" class="group flex items-start gap-3 py-2.5">
    <input
      type="checkbox"
      class="mt-1 h-4 w-4 shrink-0 accent-[var(--action)]"
      :checked="done()"
      :aria-label="done() ? t('task.reopen', { title: task.title }) : t('task.markDone', { title: task.title })"
      @change="save({ status: done() ? 'todo' : 'done' })"
    />
    <div class="min-w-0 flex-1">
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        class="field !py-1"
        maxlength="500"
        :aria-label="t('task.edit')"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc="editing = false"
        @blur="commitEdit"
      />
      <button
        v-else
        type="button"
        class="block w-full text-left break-words"
        :class="{ 'text-muted line-through': done() }"
        :title="t('task.edit')"
        @click="startEdit"
      >
        {{ task.title }}
      </button>
      <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span v-if="task.status === 'in_progress'" class="font-medium text-action">{{ t('task.status.in_progress') }}</span>
        <RouterLink
          v-if="showProject"
          :to="{ name: 'project', params: { id: task.project.id } }"
          class="inline-flex items-center gap-1.5 text-muted hover:text-ink"
        >
          <CategoryDot :category="task.category" />
          {{ task.project.name }}<template v-if="task.client"> ({{ task.client.name }})</template>
        </RouterLink>
        <select
          class="select-fit cursor-pointer bg-transparent"
          :class="priorityClass[task.priority]"
          :value="task.priority"
          :aria-label="t('task.priorityLabel')"
          @change="save({ priority: ($event.target as HTMLSelectElement).value as Task['priority'] })"
        >
          <option v-for="p in TASK_PRIORITIES" :key="p" :value="p">{{ t(`task.priority.${p}`) }}</option>
        </select>
        <span class="relative inline-flex">
          <button
            type="button"
            class="hover:text-ink"
            :class="task.dueGroup === 'overdue' ? 'text-danger font-medium' : 'text-muted'"
            :aria-label="t('task.dueDate')"
            @click="dateInput?.showPicker()"
          >
            {{ task.dueDate ? (task.dueGroup === 'today' ? t('task.dueToday') : shortDate(task.dueDate)) : t('task.dueDate') }}
          </button>
          <input
            ref="dateInput"
            type="date"
            tabindex="-1"
            aria-hidden="true"
            class="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
            :value="task.dueDate ?? ''"
            @change="save({ dueDate: ($event.target as HTMLInputElement).value || null })"
          />
        </span>
      </div>
      <p v-if="error" class="mt-1 text-xs text-danger" role="alert">{{ error }}</p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded px-1.5 text-muted opacity-60 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
      :class="{ '!text-danger !opacity-100': confirmDelete }"
      :aria-label="t('task.delete')"
      :title="t('task.delete')"
      @click="remove"
    >
      {{ confirmDelete ? t('settings.removeConfirm') : '×' }}
    </button>
  </div>
</template>
