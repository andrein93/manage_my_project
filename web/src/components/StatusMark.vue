<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ProjectStatus } from '../api'

defineProps<{ status: ProjectStatus }>()
const { t } = useI18n()
const shape: Record<ProjectStatus, string> = {
  active: 'bg-ink',
  paused: 'border-2 border-ink',
  archived: 'border border-dashed border-muted',
  ignored: 'bg-line',
}
</script>

<template>
  <span class="inline-flex items-center gap-2 text-sm">
    <span class="h-2 w-2 rounded-full" :class="shape[status]" aria-hidden="true" />
    {{ t(`status.${status}`) }}
  </span>
</template>
