<script setup lang="ts">
import { ArrowLeft, CircleDot, Code, FolderOpen, TriangleAlert } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, type CategoryRef, type NamedRef, type Project, type ProjectStatus } from '../api'
import CategoryDot from '../components/CategoryDot.vue'
import FreshnessStrip from '../components/FreshnessStrip.vue'
import ProjectTasks from '../components/ProjectTasks.vue'
import ProjectMoney from '../components/ProjectMoney.vue'
import ProjectFields from '../components/ProjectFields.vue'
import { uiLocale } from '../i18n'
import ProjectTime from '../components/ProjectTime.vue'
import TagEditor from '../components/TagEditor.vue'
import { scanTick, useAutoRefresh, useErrors } from '../composables'
import PageHeader from '../ui/PageHeader.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiButton from '../ui/UiButton.vue'
import UiCard from '../ui/UiCard.vue'
import UiSkeleton from '../ui/UiSkeleton.vue'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const router = useRouter()
const { error, report } = useErrors()

const STATUSES: ProjectStatus[] = ['active', 'paused', 'archived', 'ignored']
const project = ref<Project | null>(null)
const allTags = ref<string[]>([])
const clients = ref<NamedRef[]>([])
const categories = ref<CategoryRef[]>([])
const form = ref({
  name: '',
  description: '',
  status: 'active' as ProjectStatus,
  tags: [] as string[],
  clientId: null as string | null,
  categoryId: null as string | null,
})
const NEW_CLIENT = '__new__'
const newClientName = ref<string | null>(null)
const saving = ref(false)
const saved = ref(false)

const dirty = computed(() => {
  const p = project.value
  if (!p) return false
  return (
    form.value.name !== p.name ||
    form.value.description !== p.description ||
    form.value.status !== p.status ||
    form.value.tags.join() !== p.tags.join() ||
    form.value.clientId !== (p.client?.id ?? null) ||
    form.value.categoryId !== (p.category?.id ?? null)
  )
})

function fillForm(p: Project) {
  form.value = {
    name: p.name,
    description: p.description,
    status: p.status,
    tags: [...p.tags],
    clientId: p.client?.id ?? null,
    categoryId: p.category?.id ?? null,
  }
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
    clients.value = meta.clients
    categories.value = meta.categories
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

function onClientChange(value: string) {
  if (value === NEW_CLIENT) {
    newClientName.value = ''
    return
  }
  form.value.clientId = value || null
}

async function createClient() {
  const name = newClientName.value?.trim()
  if (!name) return
  try {
    const client = await api.createClient({ name })
    clients.value = [...clients.value, { id: client.id, name: client.name }].sort((a, b) => a.name.localeCompare(b.name))
    form.value.clientId = client.id
    newClientName.value = null
    error.value = null
  } catch (e) {
    report(e)
  }
}

const teamEnabled = ref(false)
api
  .syncStatus()
  .then((s) => (teamEnabled.value = s.configured))
  .catch(() => undefined)

async function toggleShared(shared: boolean) {
  if (!project.value) return
  try {
    const updated = await api.updateProject(project.value.id, { shared })
    project.value = updated
    // Sharing may merge this folder into the team's project, which has another id.
    if (updated.id !== props.id) router.replace({ name: 'project', params: { id: updated.id } })
  } catch (e) {
    report(e)
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
  iso ? new Date(iso).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '-'

watch(
  () => props.id,
  () => {
    project.value = null
    newClientName.value = null
    load(true)
  },
)
watch(scanTick, () => load())
useAutoRefresh(() => load())
</script>

<template>
  <div>
    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <div v-if="!project && !error" class="space-y-4">
      <UiSkeleton class="h-8 w-1/3" />
      <UiSkeleton class="h-40" />
    </div>

    <template v-if="project">
      <PageHeader :title="project.name">
        <template #before>
          <RouterLink to="/projects" class="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft class="size-3.5" aria-hidden="true" /> {{ t('detail.back') }}
          </RouterLink>
        </template>
        <template #actions>
          <label v-if="teamEnabled" class="btn">
            <input type="checkbox" class="accent-[var(--action)]" :checked="project.shared" @change="toggleShared(($event.target as HTMLInputElement).checked)" />
            {{ t('team.shared') }}
          </label>
          <template v-if="project.local">
            <UiButton :icon="FolderOpen" :disabled="!!project.missingSince" @click="open('folder')">{{ t('detail.openFolder') }}</UiButton>
            <UiButton :icon="Code" :disabled="!!project.missingSince" @click="open('vscode')">{{ t('detail.openVscode') }}</UiButton>
          </template>
        </template>
      </PageHeader>
      <div class="-mt-4 mb-6">
        <p v-if="project.client || project.category" class="flex flex-wrap items-center gap-x-3 text-sm text-muted">
          <RouterLink v-if="project.client" :to="{ name: 'client', params: { id: project.client.id } }" class="hover:text-ink">
            {{ project.client.name }}
          </RouterLink>
          <CategoryDot :category="project.category" show-name />
        </p>
        <p v-if="project.local" class="mt-1 font-mono text-xs break-all text-muted">{{ project.path }}</p>
        <p v-else class="mt-1 text-xs text-muted">{{ t('team.notHere') }}</p>
      </div>

      <p v-if="project.missingSince" class="mb-6 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{{ t('detail.missingBanner') }}</p>
      <ul v-else-if="project.health.length" class="mb-6 flex flex-wrap gap-2">
        <li v-for="f in project.health" :key="f.kind">
          <UiBadge tone="aging"><TriangleAlert class="size-3" aria-hidden="true" />{{ t(`health.${f.kind}`) }}<template v-if="f.count"> ({{ f.count }})</template></UiBadge>
        </li>
      </ul>

      <div class="space-y-4">
        <UiCard class="p-5"><ProjectTasks :project-id="project.id" /></UiCard>
        <UiCard class="p-5"><ProjectTime :project-id="project.id" /></UiCard>
        <UiCard class="p-5"><ProjectMoney :project-id="project.id" /></UiCard>
        <UiCard class="p-5"><ProjectFields :project-id="project.id" /></UiCard>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <UiCard as="form" class="space-y-5 p-5" @submit.prevent="save">
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium">{{ t('detail.name') }}</span>
            <input v-model="form.name" class="field" required maxlength="200" />
          </label>
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium">{{ t('detail.description') }}</span>
            <textarea v-model="form.description" class="field min-h-28" maxlength="5000" :placeholder="t('detail.descriptionHint')" />
          </label>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label for="project-client" class="mb-1.5 block text-sm font-medium">{{ t('detail.client') }}</label>
              <div v-if="newClientName !== null" class="flex gap-2">
                <input
                  v-model="newClientName"
                  class="field"
                  maxlength="200"
                  :placeholder="t('detail.newClientName')"
                  :aria-label="t('detail.newClientName')"
                  @keydown.enter.prevent="createClient"
                  @keydown.esc="newClientName = null"
                />
                <button type="button" class="btn btn-primary shrink-0" @click="createClient">{{ t('detail.createClient') }}</button>
                <button type="button" class="btn shrink-0" @click="newClientName = null">{{ t('detail.cancel') }}</button>
              </div>
              <select
                v-else
                id="project-client"
                class="field"
                :value="form.clientId ?? ''"
                @change="onClientChange(($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('detail.noClient') }}</option>
                <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
                <option :value="NEW_CLIENT">{{ t('detail.newClient') }}</option>
              </select>
            </div>
            <div>
              <label for="project-category" class="mb-1.5 block text-sm font-medium">{{ t('detail.category') }}</label>
              <select
                id="project-category"
                class="field"
                :value="form.categoryId ?? ''"
                @change="form.categoryId = ($event.target as HTMLSelectElement).value || null"
              >
                <option value="">{{ t('detail.noCategory') }}</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>
          <fieldset>
            <legend class="mb-1.5 text-sm font-medium">{{ t('detail.status') }}</legend>
            <div class="inline-flex flex-wrap rounded-lg border border-line bg-surface-2 p-0.5">
              <label
                v-for="s in STATUSES"
                :key="s"
                class="cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-action"
                :class="form.status === s ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
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
        </UiCard>

        <UiCard as="aside" class="p-5">
          <h2 class="label mb-3">{{ t('detail.facts') }}</h2>
          <dl class="divide-y divide-line text-sm">
            <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
              <dt class="text-muted">{{ t('detail.lastActivity') }}</dt>
              <dd><FreshnessStrip :at="project.lastActivityAt" /></dd>
            </div>
            <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
              <dt class="text-muted">{{ t('detail.stack') }}</dt>
              <dd>{{ project.stack.join(', ') || '-' }}</dd>
            </div>
            <div v-if="Object.keys(project.versions).length" class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
              <dt class="text-muted">{{ t('detail.versions') }}</dt>
              <dd class="flex flex-wrap gap-1">
                <UiBadge v-for="(v, k) in project.versions" :key="k">{{ k }} {{ v }}</UiBadge>
              </dd>
            </div>
            <template v-if="project.git">
              <div class="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
                <dt class="text-muted">{{ t('detail.branch') }}</dt>
                <dd>
                  {{ project.git.branch ?? '-' }}
                  <UiBadge v-if="project.git.dirty" tone="aging" class="ml-1"><CircleDot class="size-3" aria-hidden="true" />{{ t('list.uncommitted') }}</UiBadge>
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
        </UiCard>
      </div>
    </template>
  </div>
</template>
