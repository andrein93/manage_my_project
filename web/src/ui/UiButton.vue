<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    icon?: Component
    to?: RouteLocationRaw
    type?: 'button' | 'submit'
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
)

const classes = computed(() => [
  'btn',
  { 'btn-primary': props.variant === 'primary', 'btn-ghost': props.variant === 'ghost', 'btn-danger': props.variant === 'danger', 'btn-sm': props.size === 'sm' },
])
</script>

<template>
  <RouterLink v-if="to" :to="to" :class="classes">
    <component :is="icon" v-if="icon" class="size-4 shrink-0" aria-hidden="true" />
    <slot />
  </RouterLink>
  <button v-else :type="type" :class="classes">
    <component :is="icon" v-if="icon" class="size-4 shrink-0" aria-hidden="true" />
    <slot />
  </button>
</template>
