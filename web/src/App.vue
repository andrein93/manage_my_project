<script setup lang="ts">
import { AnimatePresence, Motion, MotionConfig } from 'motion-v'
import { CheckSquare, Clock, FolderGit2, LayoutDashboard, Menu, Search, Settings, Users, Wallet, X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { api } from './api'
import AppSidebar, { type NavLink } from './components/AppSidebar.vue'
import CommandPalette from './components/CommandPalette.vue'
import { scanTick, useErrors } from './composables'
import { finePointer } from './motion'
import { isPaletteShortcut } from './palette'
import { readPref, writePref } from './prefs'
import { pushToast } from './toasts'
import UiKbd from './ui/UiKbd.vue'
import UiToastStack from './ui/UiToastStack.vue'

const { t } = useI18n()
const route = useRoute()
const links = computed<NavLink[]>(() => [
  { to: '/', label: t('app.overview'), icon: LayoutDashboard, active: (p) => p === '/' },
  { to: '/projects', label: t('app.projects'), icon: FolderGit2, active: (p) => p.startsWith('/projects') },
  { to: '/tasks', label: t('app.tasks'), icon: CheckSquare, active: (p) => p.startsWith('/tasks') },
  { to: '/time', label: t('app.time'), icon: Clock, active: (p) => p.startsWith('/time') },
  { to: '/finance', label: t('app.finance'), icon: Wallet, active: (p) => p.startsWith('/finance') },
  { to: '/clients', label: t('app.clients'), icon: Users, active: (p) => p.startsWith('/clients') },
  { to: '/settings', label: t('app.settings'), icon: Settings, active: (p) => p.startsWith('/settings') },
])

const SIDEBAR_KEY = 'mmp.sidebar'
const collapsed = ref(readPref(SIDEBAR_KEY) === 'collapsed')
function toggleSidebar() {
  collapsed.value = !collapsed.value
  writePref(SIDEBAR_KEY, collapsed.value ? 'collapsed' : null)
}

const drawerOpen = ref(false)
const paletteOpen = ref(false)

const drawer = ref<{ $el: HTMLElement } | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)
const focusables = () => [...(drawer.value?.$el.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])]

// Modal drawer: focus moves in on open and back to the menu button on close.
watch(drawerOpen, async (open) => {
  await nextTick()
  if (open) focusables()[0]?.focus()
  else if (!paletteOpen.value) menuButton.value?.focus()
})

/** Keeps Tab inside the open drawer. */
function trapTab(e: KeyboardEvent) {
  const items = focusables()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

function openPaletteFromDrawer() {
  drawerOpen.value = false
  paletteOpen.value = true
}

const scanning = ref(false)
const { error, report, clear } = useErrors()
async function rescan() {
  if (scanning.value) return
  scanning.value = true
  clear()
  try {
    const r = await api.scan()
    pushToast(t('app.scanDone', { added: r.added, missing: r.missing, total: r.total }))
    scanTick.value++
  } catch (e) {
    report(e)
    if (error.value) pushToast(error.value, 'error')
  } finally {
    scanning.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (isPaletteShortcut(e)) {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  } else if (e.key === 'Escape' && drawerOpen.value) {
    drawerOpen.value = false
  } else if (e.key === 'Tab' && drawerOpen.value) {
    trapTab(e)
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <MotionConfig reduced-motion="user">
    <div class="min-h-screen md:flex">
      <!-- Desktop sidebar -->
      <aside
        class="sticky top-0 hidden h-screen shrink-0 border-r border-line bg-paper transition-[width] duration-200 md:block"
        :class="collapsed ? 'w-14' : 'w-60'"
      >
        <AppSidebar :links="links" :collapsed="collapsed" :scanning="scanning" @toggle="toggleSidebar" @rescan="rescan" @search="paletteOpen = true" />
      </aside>

      <!-- Mobile drawer -->
      <AnimatePresence>
        <Motion
          v-if="drawerOpen"
          class="fixed inset-0 z-40 bg-black/50 md:hidden"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :exit="{ opacity: 0 }"
          @click="drawerOpen = false"
        />
        <Motion
          v-if="drawerOpen"
          ref="drawer"
          as="aside"
          role="dialog"
          aria-modal="true"
          :aria-label="t('ui.menu')"
          class="fixed inset-y-0 left-0 z-50 w-64 border-r border-line bg-paper shadow-pop md:hidden"
          :initial="{ x: -280 }"
          :animate="{ x: 0 }"
          :exit="{ x: -280 }"
          :transition="{ type: 'spring', stiffness: 380, damping: 36 }"
        >
          <AppSidebar
            :links="links"
            :collapsed="false"
            :scanning="scanning"
            layout-id="nav-active-drawer"
            @rescan="rescan"
            @search="openPaletteFromDrawer"
            @navigate="drawerOpen = false"
          />
          <button class="absolute top-3.5 right-3 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" :aria-label="t('ui.closeMenu')" @click="drawerOpen = false">
            <X class="size-4" aria-hidden="true" />
          </button>
        </Motion>
      </AnimatePresence>

      <div class="min-w-0 flex-1">
        <div class="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper/80 px-4 py-2.5 backdrop-blur md:hidden">
          <button
            ref="menuButton"
            class="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
            :aria-label="t('ui.menu')"
            :aria-expanded="drawerOpen"
            data-focus-fallback
            @click="drawerOpen = true"
          >
            <Menu class="size-5" aria-hidden="true" />
          </button>
          <span class="font-semibold tracking-tight">mmp</span>
          <button class="ml-auto flex items-center gap-1.5 rounded-md p-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink" :aria-label="t('ui.search')" @click="paletteOpen = true">
            <Search class="size-5" aria-hidden="true" />
            <UiKbd v-if="finePointer">Ctrl K</UiKbd>
          </button>
        </div>

        <main class="relative isolate mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <RouterView v-slot="{ Component }">
            <AnimatePresence mode="wait">
              <Motion
                :key="route.path"
                :initial="{ opacity: 0, y: 4 }"
                :animate="{ opacity: 1, y: 0 }"
                :exit="{ opacity: 0, y: -4 }"
                :transition="{ duration: 0.18, ease: 'easeOut' }"
              >
                <component :is="Component" />
              </Motion>
            </AnimatePresence>
          </RouterView>
        </main>
      </div>
    </div>
    <UiToastStack />
    <CommandPalette :open="paletteOpen" :links="links" @close="paletteOpen = false" @rescan="rescan" />
  </MotionConfig>
</template>
