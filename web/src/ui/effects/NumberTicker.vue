<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { reducedMotion, tween } from '../../motion'

// `format` receives non-integer values while counting: round inside it when needed.
const props = withDefaults(defineProps<{ value: number; format?: (n: number) => string; duration?: number }>(), {
  format: (n: number) => String(Math.round(n)),
  duration: 600,
})

const shown = ref(reducedMotion.value ? props.value : 0)
let frame = 0

watch(
  () => props.value,
  (to) => {
    cancelAnimationFrame(frame)
    if (reducedMotion.value) {
      shown.value = to
      return
    }
    const from = shown.value
    const start = performance.now()
    const step = (now: number) => {
      const progress = (now - start) / props.duration
      shown.value = progress >= 1 ? to : tween(from, to, progress)
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  },
  { immediate: true },
)

onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <span class="tabular-nums" :aria-label="format(value)"><span aria-hidden="true">{{ format(shown) }}</span></span>
</template>
