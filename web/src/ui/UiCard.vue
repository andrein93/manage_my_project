<script setup lang="ts">
import { computed, ref } from 'vue'
import { finePointer, reducedMotion } from '../motion'

const props = defineProps<{ spotlight?: boolean; as?: string }>()
const el = ref<HTMLElement | null>(null)
const lit = computed(() => !!props.spotlight && finePointer && !reducedMotion.value)

function move(e: PointerEvent) {
  if (!lit.value || !el.value) return
  const r = el.value.getBoundingClientRect()
  el.value.style.setProperty('--x', `${e.clientX - r.left}px`)
  el.value.style.setProperty('--y', `${e.clientY - r.top}px`)
}
</script>

<template>
  <component :is="as ?? 'div'" ref="el" class="card relative" :class="{ spotlight: lit }" @pointermove="move">
    <slot />
  </component>
</template>
