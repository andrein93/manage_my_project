<script lang="ts">
import type { Component } from 'vue'

export interface NavLink {
  to: string
  label: string
  icon: Component
  active: (path: string) => boolean
}
</script>

<script setup lang="ts">
import { Motion } from 'motion-v'
import { PanelLeftClose, PanelLeftOpen, RefreshCw, Search } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import UiKbd from '../ui/UiKbd.vue'

defineProps<{ links: NavLink[]; collapsed: boolean; scanning: boolean }>()
const emit = defineEmits<{ toggle: []; rescan: []; search: []; navigate: [] }>()
const { t } = useI18n()
const route = useRoute()
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
</script>

<template>
  <div class="flex h-full flex-col gap-1 p-3">
    <div class="mb-3 flex items-center gap-2 px-1.5" :class="collapsed ? 'justify-center' : 'justify-between'">
      <RouterLink to="/" class="flex items-center gap-2 text-[15px] font-semibold tracking-tight" @click="emit('navigate')">
        <img src="/favicon.svg" alt="" class="size-6" />
        <span v-if="!collapsed">mmp</span>
      </RouterLink>
      <button v-if="!collapsed" class="hidden rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink md:block" :aria-label="t('ui.collapse')" @click="emit('toggle')">
        <PanelLeftClose class="size-4" aria-hidden="true" />
      </button>
    </div>

    <button
      class="mb-2 flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-muted shadow-card hover:border-line-strong hover:text-ink"
      :class="{ 'justify-center px-0': collapsed }"
      :aria-label="t('ui.search')"
      @click="emit('search')"
    >
      <Search class="size-4 shrink-0" aria-hidden="true" />
      <template v-if="!collapsed">
        <span class="flex-1 text-left">{{ t('ui.search') }}</span>
        <UiKbd>{{ isMac ? '⌘' : 'Ctrl' }} K</UiKbd>
      </template>
    </button>

    <nav class="flex flex-col gap-0.5">
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors"
        :class="[link.active(route.path) ? 'text-ink' : 'text-muted hover:text-ink', { 'justify-center px-0': collapsed }]"
        :title="collapsed ? link.label : undefined"
        @click="emit('navigate')"
      >
        <Motion
          v-if="link.active(route.path)"
          layout-id="nav-active"
          class="absolute inset-0 rounded-md border border-line bg-surface-2 shadow-card"
          :transition="{ type: 'spring', stiffness: 500, damping: 38 }"
        />
        <component :is="link.icon" class="relative size-4 shrink-0" aria-hidden="true" />
        <span v-if="!collapsed" class="relative truncate">{{ link.label }}</span>
      </RouterLink>
    </nav>

    <div class="mt-auto flex flex-col gap-1">
      <button v-if="collapsed" class="hidden justify-center rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink md:flex" :aria-label="t('ui.expand')" @click="emit('toggle')">
        <PanelLeftOpen class="size-4" aria-hidden="true" />
      </button>
      <button class="btn w-full" :class="{ 'px-0': collapsed }" :disabled="scanning" :title="collapsed ? t('app.rescan') : undefined" @click="emit('rescan')">
        <RefreshCw class="size-4" :class="{ 'animate-spin': scanning }" aria-hidden="true" />
        <span v-if="!collapsed">{{ scanning ? t('app.scanning') : t('app.rescan') }}</span>
      </button>
    </div>
  </div>
</template>
