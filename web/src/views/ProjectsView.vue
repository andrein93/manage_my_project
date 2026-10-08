<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type Meta, type Project } from '../api'
import CategoryDot from '../components/CategoryDot.vue'
import FreshnessStrip from '../components/FreshnessStrip.vue'
import StatusMark from '../components/StatusMark.vue'
import { scanTick, useAutoRefresh, useErrors } from '../composables'

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
  sort: q('sort') || 'activity',
}))
function setFilter(key: string, value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined } })
}
const hasFilters = computed(() => ['q', 'status', 'stack', 'tag', 'inactive', 'client', 'category'].some((k) => q(k)))

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
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('app.projects') }}</h1>
      <p class="text-sm text-muted">{{ t('list.count', { n: sorted.length }, sorted.length) }}</p>
    </div>

    <input v-model="search" type="search" class="field mb-2" :placeholder="t('list.search')" :aria-label="t('list.search')" />
    <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
      <select class="field" :value="filters.client" aria-label="Client" @change="setFilter('client', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyClient') }}</option>
        <option value="none">{{ t('list.noClient') }}</option>
        <option v-for="c in meta?.clients" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <select class="field" :value="filters.category" aria-label="Category" @change="setFilter('category', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyCategory') }}</option>
        <option value="none">{{ t('list.noCategory') }}</option>
        <option v-for="c in meta?.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <select class="field" :value="filters.status" aria-label="Status" @change="setFilter('status', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyStatus') }}</option>
        <option v-for="s in meta?.statuses" :key="s" :value="s">{{ t(`status.${s}`) }} ({{ meta?.counts[s] }})</option>
        <option value="all">{{ t('list.allStatuses') }}</option>
      </select>
      <select class="field" :value="filters.stack" aria-label="Stack" @change="setFilter('stack', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyStack') }}</option>
        <option v-for="s in meta?.stacks" :key="s" :value="s">{{ s }}</option>
      </select>
      <select v-if="meta?.tags.length" class="field" :value="filters.tag" aria-label="Tag" @change="setFilter('tag', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyTag') }}</option>
        <option v-for="tag in meta?.tags" :key="tag" :value="tag">{{ tag }}</option>
      </select>
      <select class="field" :value="filters.inactive" aria-label="Activity" @change="setFilter('inactive', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('list.anyActivity') }}</option>
        <option v-for="d in [30, 90, 180, 365]" :key="d" :value="String(d)">{{ t('list.inactiveFor', { days: d }) }}</option>
      </select>
      <select class="field" :value="filters.sort" aria-label="Sort" @change="setFilter('sort', ($event.target as HTMLSelectElement).value === 'activity' ? '' : 'name')">
        <option value="activity">{{ t('list.sortActivity') }}</option>
        <option value="name">{{ t('list.sortName') }}</option>
      </select>
    </div>

    <p v-if="error" class="mb-4 text-sm text-danger">{{ error }}</p>

    <ul v-if="sorted.length" class="divide-y divide-line border-y border-line">
      <li v-for="p in sorted" :key="p.id">
        <RouterLink
          :to="{ name: 'project', params: { id: p.id } }"
          class="grid gap-x-6 gap-y-2 px-1 py-3.5 hover:bg-surface sm:grid-cols-[minmax(0,1fr)_14rem_11rem_6rem] sm:items-center"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-x-2">
              <CategoryDot :category="p.category" reserve />
              <span class="font-medium" :class="{ 'text-muted line-through': p.missingSince }">{{ p.name }}</span>
              <span v-if="p.client" class="text-sm text-muted">{{ p.client.name }}</span>
              <span v-if="p.missingSince" class="text-xs text-danger">{{ t('list.missing') }}</span>
              <span v-if="p.git?.dirty" class="text-xs text-aging" :title="t('list.uncommitted')">● {{ t('list.uncommitted') }}</span>
            </div>
            <p v-if="p.description" class="truncate text-sm text-muted">{{ p.description }}</p>
            <p v-else class="truncate font-mono text-xs text-muted">{{ p.path }}</p>
          </div>
          <div class="flex flex-wrap gap-1">
            <span v-for="s in p.stack" :key="s" class="rounded border border-line px-1.5 text-xs text-muted">{{ s }}</span>
            <span v-for="tag in p.tags" :key="tag" class="rounded bg-line/60 px-1.5 text-xs">#{{ tag }}</span>
          </div>
          <FreshnessStrip :at="p.lastActivityAt" />
          <StatusMark :status="p.status" />
        </RouterLink>
      </li>
    </ul>

    <div v-else-if="loaded && !error" class="border-y border-line py-16 text-center">
      <p class="font-medium">{{ t('list.emptyTitle') }}</p>
      <p class="mt-1 text-sm text-muted">{{ t('list.emptyHint') }}</p>
      <div class="mt-4 flex justify-center gap-2">
        <button v-if="hasFilters" class="btn" @click="search = ''; router.replace({ query: {} })">{{ t('list.clear') }}</button>
        <RouterLink to="/settings" class="btn">{{ t('app.settings') }}</RouterLink>
      </div>
    </div>
  </section>
</template>
