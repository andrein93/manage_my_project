<script setup lang="ts">
import { Motion } from 'motion-v'
import { reducedMotion, staggerDelay } from '../../motion'

defineProps<{ index: number; as?: keyof HTMLElementTagNameMap }>()
</script>

<template>
  <Motion
    :as="as ?? 'div'"
    :initial="reducedMotion ? false : { opacity: 0, y: 6 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="{ duration: 0.25, ease: 'easeOut', delay: staggerDelay(index, reducedMotion) }"
  >
    <slot />
  </Motion>
</template>
