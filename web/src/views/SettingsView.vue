<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, type Workspace } from '../api'
import CategoriesSettings from '../components/CategoriesSettings.vue'
import CommandReference from '../components/CommandReference.vue'
import FinanceSettings from '../components/FinanceSettings.vue'
import LanguageSettings from '../components/LanguageSettings.vue'
import ThemeSettings from '../components/ThemeSettings.vue'
import PageHeader from '../ui/PageHeader.vue'
import UiCard from '../ui/UiCard.vue'
import TimeSettings from '../components/TimeSettings.vue'
import { scanTick, useErrors } from '../composables'

const { t } = useI18n()
const router = useRouter()
const { error, report } = useErrors()

const workspaces = ref<Workspace[]>([])
const newWorkspace = ref('')
const newProject = ref('')
const ignoreText = ref('')
const confirmRemove = ref<string | null>(null)
const busy = ref(false)
const ignoreSaved = ref(false)


async function load() {
  try {
    const [ws, settings] = await Promise.all([api.workspaces(), api.settings()])
    workspaces.value = ws
    ignoreText.value = settings.ignoreNames.join('\n')
  } catch (e) {
    report(e)
  }
}

/** Reloads only the workspace list, keeping unsaved edits elsewhere on the page. */
async function loadWorkspaces() {
  workspaces.value = await api.workspaces()
}

async function run(action: () => Promise<unknown>) {
  busy.value = true
  error.value = null
  try {
    await action()
  } catch (e) {
    report(e)
  } finally {
    busy.value = false
  }
}

const addWorkspace = () =>
  run(async () => {
    await api.addWorkspace(newWorkspace.value.trim())
    newWorkspace.value = ''
    scanTick.value++
    await loadWorkspaces()
  })

function removeWorkspace(id: string) {
  // Two-step confirmation without a browser dialog.
  if (confirmRemove.value !== id) {
    confirmRemove.value = id
    return
  }
  confirmRemove.value = null
  run(async () => {
    await api.removeWorkspace(id)
    scanTick.value++
    await loadWorkspaces()
  })
}

const addProject = () =>
  run(async () => {
    const project = await api.addProject(newProject.value.trim())
    newProject.value = ''
    router.push({ name: 'project', params: { id: project.id } })
  })

const saveIgnore = () =>
  run(async () => {
    const settings = await api.updateSettings({ ignoreNames: ignoreText.value.split('\n') })
    ignoreText.value = settings.ignoreNames.join('\n')
    ignoreSaved.value = true
    setTimeout(() => (ignoreSaved.value = false), 3000)
  })

onMounted(load)
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <PageHeader :title="t('app.settings')" />
    <p v-if="error" class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <UiCard class="p-5"><ThemeSettings /></UiCard>
    <UiCard class="p-5"><LanguageSettings /></UiCard>

    <UiCard as="section" class="p-5">
      <h2 class="text-lg font-semibold">{{ t('settings.workspaces') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('settings.workspacesHint') }}</p>
      <ul class="mt-4 divide-y divide-line">
        <li v-for="w in workspaces" :key="w.id" class="flex items-center justify-between gap-4 py-2.5">
          <span class="font-mono text-sm break-all">{{ w.path }}</span>
          <button
            class="btn shrink-0"
            :class="{ '!border-danger !text-danger': confirmRemove === w.id }"
            :disabled="busy"
            @click="removeWorkspace(w.id)"
          >
            {{ confirmRemove === w.id ? t('settings.removeConfirm') : t('settings.remove') }}
          </button>
        </li>
      </ul>
      <form class="mt-3 flex gap-2" @submit.prevent="addWorkspace">
        <input v-model="newWorkspace" class="field font-mono" required :placeholder="t('settings.workspacePath')" :aria-label="t('settings.workspacePath')" />
        <button class="btn btn-primary shrink-0" :disabled="busy">{{ t('settings.addWorkspace') }}</button>
      </form>
    </UiCard>

    <UiCard as="section" class="p-5">
      <h2 class="text-lg font-semibold">{{ t('settings.addProject') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('settings.addProjectHint') }}</p>
      <form class="mt-3 flex gap-2" @submit.prevent="addProject">
        <input v-model="newProject" class="field font-mono" required :placeholder="t('settings.projectPath')" :aria-label="t('settings.projectPath')" />
        <button class="btn btn-primary shrink-0" :disabled="busy">{{ t('settings.add') }}</button>
      </form>
    </UiCard>

    <UiCard class="p-5"><CategoriesSettings /></UiCard>

    <UiCard class="p-5"><TimeSettings /></UiCard>

    <UiCard class="p-5"><FinanceSettings /></UiCard>

    <UiCard as="section" class="p-5">
      <h2 class="text-lg font-semibold">{{ t('settings.ignore') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('settings.ignoreHint') }}</p>
      <textarea v-model="ignoreText" class="field mt-3 min-h-32 font-mono" :aria-label="t('settings.ignore')" />
      <div class="mt-2 flex items-center gap-3">
        <button class="btn" :disabled="busy" @click="saveIgnore">{{ t('settings.saveIgnore') }}</button>
        <span v-if="ignoreSaved" class="text-sm text-fresh" role="status">{{ t('detail.saved') }}</span>
      </div>
    </UiCard>

    <UiCard class="p-5"><CommandReference /></UiCard>
  </div>
</template>
