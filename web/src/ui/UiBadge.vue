<script setup lang="ts">
const props = withDefaults(defineProps<{ tone?: 'neutral' | 'accent' | 'fresh' | 'aging' | 'dormant' | 'danger' }>(), { tone: 'neutral' })

const tones: Record<string, string> = {
  neutral: 'border-line text-muted',
  accent: 'border-action/30 bg-action/10 text-action',
  fresh: 'border-fresh/30 bg-fresh/10 text-fresh',
  aging: 'border-aging/30 bg-aging/10 text-aging',
  dormant: 'border-dormant/30 bg-dormant/10 text-dormant',
  danger: 'border-danger/30 bg-danger/10 text-danger',
}
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap" :class="tones[props.tone]">
    <slot />
  </span>
</template>
