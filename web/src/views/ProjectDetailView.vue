<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Project, type ProjectStatus } from '../api'
import FreshnessStrip from '../components/FreshnessStrip.vue'
import TagEditor from '../components/TagEditor.vue'
import { scanTick, useAutoRefresh, useErrors } from '../composables'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const { error, report } = useErrors()

const STATUSES: ProjectStatus[] = ['active', 'paused', 'archived', 'ignored']
const project = ref<Project | null>(null)
const allTags = ref<string[]>([])
const form = ref({ name: '', description: '', status: 'active' as ProjectStatus, tags: [] as string[] })
const saving = ref(false)
const saved = ref(false)

const dirty = computed(() => {
  const p = project.value
  if (!p) return false
  return (
    form.value.name !== p.name ||
    form.value.description !== p.description ||
    form.value.status !== p.status ||
    form.value.tags.join() !== p.tags.join()
  )
})

function fillForm(p: Project) {
  form.value = { name: p.name, description: p.description, status: p.status, tags: [...p.tags] }
}

/** Background refreshes never overwrite unsaved edits; `force` (a different project) does. */
async function load(force = false) {
  if (dirty.value && !force) return
  const id = props.id
  try {
    const [p, meta] = await Promise.all([api.project(id), api.meta()])
    // Ignore stale responses and edits started while the request was in flight.
    if (id !== props.id || (dirty.value && !force)) return
    project.value = p
    allTags.value = meta.tags
    fillForm(p)
  } catch (e) {
    report(e)
  }
}

async function save() {
  if (!project.value) return
  saving.value = true
  error.value = null
  try {
    const updated = await api.updateProject(project.value.id, { ...form.value })
    project.value = updated
    fillForm(updated)
    saved.value = true
    setTimeout(() => (saved.value = false), 3000)
  } catch (e) {
    report(e)
  } finally {
    saving.value = false
  }
}

async function open(target: 'folder' | 'vscode') {
  try {
    await api.open(props.id, target)
  } catch (e) {
    report(e)
  }
}

const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-'

watch(
  () => props.id,
  () => {
    project.value = null
    load(true)
  },
)
watch(scanTick, () => load())
useAutoRefresh(() => load())
</script>

<template>
  <div>
    <RouterLink to="/" class="text-sm text-muted hover:text-ink">← {{ t('detail.back') }}</RouterLink>
    <p v-if="error" class="mt-4 text-sm text-danger" role="alert">{{ error }}</p>

    <template v-if="project">
      <div class="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight">{{ project.name }}</h1>
          <p class="mt-1 font-mono text-xs break-all text-muted">{{ project.path }}</p>
        </div>
        <div class="flex gap-2">
          <button class="btn" :disabled="!!project.missingSince" @click="open('folder')">{{ t('detail.openFolder') }}</button>
          <button class="btn" :disabled="!!project.missingSince" @click="open('vscode')">{{ t('detail.openVscode') }}</button>
        </div>
      </div>

      <p v-if="project.missingSince" class="mt-4 border-l-2 border-danger pl-3 text-sm">{{ t('detail.missingBanner') }}</p>

      <div class="mt-8 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <form class="space-y-5" @submit.prevent="save">
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium">{{ t('detail.name') }}</span>
            <input v-model="form.name" class="field" required maxlength="200" />
          </label>
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium">{{ t('detail.description') }}</span>
            <textarea v-model="form.description" class="field min-h-28" maxlength="5000" :placeholder="t('detail.descriptionHint')" />
          </label>
          <fieldset>
            <legend class="mb-1.5 text-sm font-medium">{{ t('detail.status') }}</legend>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="s in STATUSES"
                :key="s"
                class="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-action"
                :class="form.status === s ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink hover:border-ink'"
              >
                <input v-model="form.status" type="radio" class="sr-only" :value="s" />
                {{ t(`status.${s}`) }}
              </label>
            </div>
          </fieldset>
          <div>
            <span class="mb-1.5 block text-sm font-medium">{{ t('detail.tags') }}</span>
            <TagEditor v-model="form.tags" :suggestions="allTags" />
          </div>
          <div class="flex items-center gap-3">
            <button type="submit" class="btn btn-primary" :disabled="!dirty || saving">{{ t('detail.save') }}</button>
            <span v-if="saved" class="text-sm text-fresh" role="status">{{ t('detail.saved') }}</span>
          </div>
        </form>

        <aside>
          <h2 class="mb-3 text-sm font-medium text-muted">{{ t('detail.facts') }}</h2>
          <dl class="divide-y divide-line border-y border-line text-sm">
            <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
              <dt class="text-muted">{{ t('detail.lastActivity') }}</dt>
              <dd><FreshnessStrip :at="project.lastActivityAt" /></dd>
            </div>
            <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
              <dt class="text-muted">{{ t('detail.stack') }}</dt>
              <dd>{{ project.stack.join(', ') || '-' }}</dd>
            </div>
            <template v-if="project.git">
              <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
                <dt class="text-muted">{{ t('detail.branch') }}</dt>
                <dd>
                  {{ project.git.branch ?? '-' }}
                  <span v-if="project.git.dirty" class="ml-1 text-aging">● {{ t('list.uncommitted') }}</span>
                </dd>
              </div>
              <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
                <dt class="text-muted">{{ t('detail.lastCommit') }}</dt>
                <dd>{{ date(project.git.lastCommitAt) }}</dd>
              </div>
              <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
                <dt class="text-muted">{{ t('detail.remote') }}</dt>
                <dd class="font-mono text-xs break-all">{{ project.git.remote ?? '-' }}</dd>
              </div>
            </template>
            <div v-else class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
              <dt class="text-muted">Git</dt>
              <dd class="text-muted">{{ t('detail.noGit') }}</dd>
            </div>
            <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
              <dt class="text-muted">{{ t('detail.source') }}</dt>
              <dd>{{ project.source === 'scan' ? t('detail.sourceScan') : t('detail.sourceManual') }}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </template>
  </div>
</template>
