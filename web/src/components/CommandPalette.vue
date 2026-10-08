<script setup lang="ts">
import { AnimatePresence, Motion } from 'motion-v'
import { CheckSquare, CornerDownLeft, FolderGit2, RefreshCw, Search, SunMoon, Users } from 'lucide-vue-next'
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { scanTick } from '../composables'
import { searchPalette, type PaletteGroup, type PaletteItem } from '../palette'
import { THEME_PREFERENCES, setThemePreference } from '../theme'
import UiKbd from '../ui/UiKbd.vue'
import type { NavLink } from './AppSidebar.vue'

const props = defineProps<{ open: boolean; links: NavLink[] }>()
const emit = defineEmits<{ close: []; rescan: [] }>()
const { t } = useI18n()
const router = useRouter()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const remote = ref<PaletteItem[]>([])
let loadedTick = -1
let returnFocus: HTMLElement | null = null

const groupIcon: Record<PaletteGroup, Component> = { pages: Search, projects: FolderGit2, tasks: CheckSquare, clients: Users, actions: SunMoon }

async function load() {
  if (loadedTick === scanTick.value) return
  try {
    const [projects, tasks, clients] = await Promise.all([api.projects({}), api.tasks({ status: 'todo,in_progress' }), api.clients()])
    loadedTick = scanTick.value
    remote.value = [
      ...projects.map((p) => ({ id: `project:${p.id}`, group: 'projects' as const, label: p.name, hint: p.client?.name, keywords: p.path })),
      ...tasks.map((x) => ({ id: `task:${x.id}:${x.project.id}`, group: 'tasks' as const, label: x.title, hint: x.project.name })),
      ...clients.map((c) => ({ id: `client:${c.id}`, group: 'clients' as const, label: c.name, keywords: c.email })),
    ]
  } catch {
    // Offline: pages and actions still work; retry on next open.
  }
}

const staticItems = computed<PaletteItem[]>(() => [
  ...props.links.map((l) => ({ id: `page:${l.to}`, group: 'pages' as const, label: l.label })),
  { id: 'action:rescan', group: 'actions' as const, label: t('app.rescan') },
  ...THEME_PREFERENCES.map((p) => ({ id: `theme:${p}`, group: 'actions' as const, label: t(`ui.palette.theme${p[0].toUpperCase()}${p.slice(1)}`) })),
])

const groups = computed(() => searchPalette([...staticItems.value, ...remote.value], query.value))
const flat = computed(() => groups.value.flatMap((g) => g.items))

watch(query, () => (active.value = 0))
watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement as HTMLElement | null
      query.value = ''
      active.value = 0
      void load()
      await nextTick()
      input.value?.focus()
    } else {
      returnFocus?.focus?.()
    }
  },
)

function run(item: PaletteItem) {
  const [kind, id, extra] = item.id.split(':')
  if (kind === 'page') router.push(item.id.slice('page:'.length))
  else if (kind === 'project') router.push({ name: 'project', params: { id } })
  else if (kind === 'task') router.push({ name: 'project', params: { id: extra } })
  else if (kind === 'client') router.push({ name: 'client', params: { id } })
  else if (kind === 'action' && id === 'rescan') emit('rescan')
  else if (kind === 'theme') setThemePreference(id as (typeof THEME_PREFERENCES)[number])
  emit('close')
}

function onKey(e: KeyboardEvent) {
  const n = flat.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (n) active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (n) active.value = (active.value - 1 + n) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = flat.value[active.value]
    if (item) run(item)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'Tab') {
    e.preventDefault() // focus stays in the search field
  }
}

watch(active, async (i) => {
  await nextTick()
  document.getElementById(`palette-item-${i}`)?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <AnimatePresence>
    <Motion
      v-if="open"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.15 }"
      @click="emit('close')"
    />
    <Motion
      v-if="open"
      class="fixed inset-x-4 top-[12vh] z-50 mx-auto max-w-xl overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop"
      role="dialog"
      aria-modal="true"
      :aria-label="t('ui.search')"
      :initial="{ opacity: 0, scale: 0.97, y: -8 }"
      :animate="{ opacity: 1, scale: 1, y: 0 }"
      :exit="{ opacity: 0, scale: 0.98 }"
      :transition="{ type: 'spring', stiffness: 500, damping: 36 }"
    >
      <div class="flex items-center gap-3 border-b border-line px-4">
        <Search class="size-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          class="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted focus-visible:outline-none"
          :placeholder="t('ui.palette.placeholder')"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          :aria-activedescendant="flat.length ? `palette-item-${active}` : undefined"
          @keydown="onKey"
        />
        <UiKbd>Esc</UiKbd>
      </div>

      <div id="palette-list" class="max-h-[min(60vh,26rem)] overflow-y-auto p-2" role="listbox">
        <p v-if="!flat.length" class="px-3 py-8 text-center text-sm text-muted">{{ t('ui.palette.empty', { query }) }}</p>
        <section v-for="g in groups" :key="g.group" class="mb-1">
          <p class="label px-2.5 pt-2 pb-1">{{ t(`ui.palette.${g.group}`) }}</p>
          <button
            v-for="item in g.items"
            :id="`palette-item-${flat.indexOf(item)}`"
            :key="item.id"
            type="button"
            tabindex="-1"
            role="option"
            :aria-selected="flat.indexOf(item) === active"
            class="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm"
            :class="flat.indexOf(item) === active ? 'bg-surface-2 text-ink' : 'text-muted'"
            @mousemove="active = flat.indexOf(item)"
            @click="run(item)"
          >
            <component :is="item.id === 'action:rescan' ? RefreshCw : groupIcon[g.group]" class="size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-ink">{{ item.label }}</span>
            <span v-if="item.hint" class="max-w-[40%] shrink-0 truncate text-xs">{{ item.hint }}</span>
            <CornerDownLeft v-if="flat.indexOf(item) === active" class="size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </section>
      </div>

      <div class="hidden items-center gap-4 border-t border-line px-4 py-2 text-xs text-muted sm:flex">
        <span class="flex items-center gap-1.5"><UiKbd>↑</UiKbd><UiKbd>↓</UiKbd> {{ t('ui.palette.navigate') }}</span>
        <span class="flex items-center gap-1.5"><UiKbd>↵</UiKbd> {{ t('ui.palette.select') }}</span>
        <span class="flex items-center gap-1.5"><UiKbd>Esc</UiKbd> {{ t('ui.palette.close') }}</span>
      </div>
    </Motion>
  </AnimatePresence>
</template>
