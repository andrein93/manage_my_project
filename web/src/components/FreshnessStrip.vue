<script setup lang="ts">
import { computed } from 'vue'
import { freshness, tickPosition, useRelativeTime } from '../composables'

const props = defineProps<{ at: string | null }>()
const relative = useRelativeTime()
const f = computed(() => freshness(props.at))

// Reference marks: one week, one month, six months, one year.
const ticks = [7, 30, 180, 365].map(tickPosition)
const color = { fresh: 'bg-fresh', aging: 'bg-aging', dormant: 'bg-dormant', never: 'bg-line' } as const
</script>

<template>
  <div class="flex items-center gap-3" :title="at ?? undefined">
    <div class="relative h-3 w-28 shrink-0" aria-hidden="true">
      <div class="absolute inset-x-0 top-1/2 h-px bg-line" />
      <div v-for="x in ticks" :key="x" class="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-line" :style="{ left: `${x * 100}%` }" />
      <div
        class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-paper"
        :class="color[f.bucket]"
        :style="{ left: `${f.position * 100}%` }"
      />
    </div>
    <span class="w-16 text-xs text-muted tabular-nums">{{ relative(f.days) }}</span>
  </div>
</template>
