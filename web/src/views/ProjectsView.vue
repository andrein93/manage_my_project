<script setup lang="ts">
import { CircleDot, FolderGit2, Search, TriangleAlert } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type Meta, type Project } from '../api'
import CategoryDot from '../components/CategoryDot.vue'
import FreshnessStrip from '../components/FreshnessStrip.vue'
import StatusMark from '../components/StatusMark.vue'
import { scanTick, useAutoRefresh, useErrors, useSavedQuery } from '../composables'
import PageHeader from '../ui/PageHeader.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiButton from '../ui/UiButton.vue'
import UiCard from '../ui/UiCard.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import UiSkeleton from '../ui/UiSkeleton.vue'
import StaggerItem from '../ui/effects/StaggerItem.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { error, report } = useErrors()

const projects = ref<Project[]>([])
const meta = ref<Meta | null>(null)
const loaded = ref(false)

// Filters live in the URL so back/forward and reloads keep them.
const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const filters = computed(() => ({
  q: q('q'),
  status: q('status'),
  stack: q('stack'),
  tag: q('tag'),
  inactive: q('inactive'),
  client: q('client'),
  category: q('category'),
  attention: q('attention'),
  framework: q('framework'),
  sort: q('sort') || 'activity',
}))
function setFilter(key: string, value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined } })
}
/** Most important health flag, skipping "uncommitted" which already has its own marker. */
const mainFlag = (p: Project) => p.health.find((f) => f.kind !== 'uncommitted')?.kind ?? null
// Filters (and sort) are remembered per browser; "Reset filters" forgets them.
const FILTER_KEYS = ['q', 'status', 'stack', 'tag', 'inactive', 'client', 'category', 'attention', 'framework', 'sort']
const { reset: resetQuery } = useSavedQuery('mmp.projects.filters', FILTER_KEYS)
function resetFilters() {
  search.value = ''
  resetQuery()
}
const hasFilters = computed(() => FILTER_KEYS.some((k) => q(k)))

let latestRequest = 0
async function load() {
  const request = ++latestRequest
  try {
    const f = filters.value
    const params: Record<string, string> = {}
    if (f.q) params.q = f.q
    if (f.status === 'all') params.all = 'true'
    else if (f.status) params.status = f.status
    if (f.stack) params.stack = f.stack
    if (f.tag) params.tag = f.tag
    if (f.inactive) params.inactive = f.inactive
    if (f.client) params.client = f.client
    if (f.category) params.category = f.category
    if (f.attention) params.attention = 'true'
    if (f.framework) params.version = f.framework
    const [list, m] = await Promise.all([api.projects(params), api.meta()])
    // Out-of-order responses (typing, focus, interval) must not show stale filters.
    if (request !== latestRequest) return
    projects.value = list
    meta.value = m
    error.value = null
  } catch (e) {
    report(e)
  } finally {
    loaded.value = true
  }
}

const sorted = computed(() => {
  const list = [...projects.value]
  if (filters.value.sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name))
  return list.sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
})

let searchTimer: ReturnType<typeof setTimeout> | undefined
const search = ref(q('q'))
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setFilter('q', value.trim()), 200)
})

watch(() => route.query, load)
// Keep the search box in sync on back/forward navigation.
watch(
  () => q('q'),
  (value) => {
    if (value !== search.value.trim()) search.value = value
  },
)
watch(scanTick, load)
useAutoRefresh(load)
</script>

<template>
  <section>
    <PageHeader :title="t('app.projects')" :subtitle="t('list.count', { n: sorted.length }, sorted.length)" />

    <div class="relative mb-2">
      <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input v-model="search" type="search" class="field pl-9" :placeholder="t('list.search')" :aria-label="t('list.search')" />
    </div>
    <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <select class="field" :value="filters.attention" :aria-label="t('a11y.attention')" @change="setFilter('attention', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyHealth') }}</option>
        <option value="1">{{ t('list.needsAttention', { n: meta?.attention ?? 0 }) }}</option>
      </select>
      <select v-if="meta?.versions.length" class="field" :value="filters.framework" :aria-label="t('a11y.framework')" @change="setFilter('framework', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyFramework') }}</option>
        <option v-for="v in meta?.versions" :key="v" :value="v">{{ v.replace('@', ' ') }}</option>
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
      <select class="field" :value="filters.status" :aria-label="t('a11y.status')" @change="setFilter('status', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyStatus') }}</option>
        <option v-for="s in meta?.statuses" :key="s" :value="s">{{ t(`status.${s}`) }} ({{ meta?.counts[s] }})</option>
        <option value="all">{{ t('list.allStatuses') }}</option>
      </select>
      <select class="field" :value="filters.stack" :aria-label="t('a11y.stack')" @change="setFilter('stack', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyStack') }}</option>
        <option v-for="s in meta?.stacks" :key="s" :value="s">{{ s }}</option>
      </select>
      <select v-if="meta?.tags.length" class="field" :value="filters.tag" :aria-label="t('a11y.tag')" @change="setFilter('tag', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyTag') }}</option>
        <option v-for="tag in meta?.tags" :key="tag" :value="tag">{{ tag }}</option>
      </select>
      <select class="field" :value="filters.inactive" :aria-label="t('a11y.activity')" @change="setFilter('inactive', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyActivity') }}</option>
        <option v-for="d in [30, 90, 180, 365]" :key="d" :value="String(d)">{{ t('list.inactiveFor', { days: d }) }}</option>
      </select>
      <select class="field" :value="filters.sort" :aria-label="t('a11y.sort')" @change="setFilter('sort', ($event.target as HTMLSelectElement).value === 'activity' ? '' : 'name')">
        <option value="activity">{{ t('list.sortActivity') }}</option>
        <option value="name">{{ t('list.sortName') }}</option>
      </select>
      <button v-if="hasFilters" type="button" class="btn justify-center" :title="t('list.filtersRemembered')" @click="resetFilters">{{ t('list.clear') }}</button>
    </div>

    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <UiCard v-if="!loaded && !error" class="divide-y divide-line">
      <div v-for="n in 6" :key="n" class="p-4">
        <UiSkeleton class="h-4 w-1/3" />
        <UiSkeleton class="mt-2 h-3 w-1/2" />
      </div>
    </UiCard>

    <UiCard v-if="sorted.length" spotlight as="ul" class="divide-y divide-line overflow-hidden">
      <StaggerItem v-for="(p, i) in sorted" :key="p.id" :index="i" as="li">
        <RouterLink
          :to="{ name: 'project', params: { id: p.id } }"
          class="grid gap-x-6 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_14rem_11rem_7rem] sm:items-center"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-x-2">
              <CategoryDot :category="p.category" reserve />
              <span class="font-medium" :class="{ 'text-muted line-through': p.missingSince }">{{ p.name }}</span>
              <span v-if="p.client" class="text-sm text-muted">{{ p.client.name }}</span>
              <UiBadge v-if="mainFlag(p) && !p.missingSince" tone="aging"><TriangleAlert class="size-3" aria-hidden="true" />{{ t(`health.${mainFlag(p)}`) }}</UiBadge>
              <UiBadge v-if="p.missingSince" tone="danger">{{ t('list.missing') }}</UiBadge>
              <UiBadge v-if="p.git?.dirty" tone="aging" :title="t('list.uncommitted')"><CircleDot class="size-3" aria-hidden="true" />{{ t('list.uncommitted') }}</UiBadge>
            </div>
            <p v-if="p.description" class="truncate text-sm text-muted">{{ p.description }}</p>
            <p v-else-if="p.local" class="truncate font-mono text-xs text-muted">{{ p.path }}</p>
            <p v-else class="truncate text-xs text-muted">{{ t('team.notHere') }}</p>
          </div>
          <div class="flex flex-wrap gap-1">
            <UiBadge v-for="s in p.stack" :key="s">{{ s }}</UiBadge>
            <UiBadge v-for="tag in p.tags" :key="tag" tone="accent">#{{ tag }}</UiBadge>
          </div>
          <FreshnessStrip :at="p.lastActivityAt" />
          <StatusMark :status="p.status" class="justify-self-start" />
        </RouterLink>
      </StaggerItem>
    </UiCard>

    <UiEmpty v-else-if="loaded && !error" :icon="FolderGit2" :title="t('list.emptyTitle')" :hint="t('list.emptyHint')">
      <UiButton v-if="hasFilters" @click="resetFilters">{{ t('list.clear') }}</UiButton>
      <UiButton to="/settings">{{ t('app.settings') }}</UiButton>
    </UiEmpty>
  </section>
</template>
