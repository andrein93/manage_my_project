<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ProjectStatus } from '../api'
import UiBadge from '../ui/UiBadge.vue'

defineProps<{ status: ProjectStatus }>()
const { t } = useI18n()
const tone = { active: 'fresh', paused: 'aging', archived: 'dormant', ignored: 'neutral' } as const
const dot: Record<ProjectStatus, string> = {
  active: 'bg-current',
  paused: 'border-[1.5px] border-current',
  archived: 'border border-dashed border-current',
  ignored: 'bg-line-strong',
}
</script>

<template>
  <UiBadge :tone="tone[status]">
    <span class="size-1.5 rounded-full" :class="dot[status]" aria-hidden="true" />
    {{ t(`status.${status}`) }}
  </UiBadge>
</template>
