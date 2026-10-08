<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icon: Component; title: string; hint?: string }>()
</script>

<template>
  <div class="card flex flex-col items-center px-6 py-14 text-center">
    <div class="mb-4 grid size-11 place-items-center rounded-lg border border-line bg-surface-2 text-muted shadow-card">
      <component :is="icon" class="size-5" aria-hidden="true" />
    </div>
    <p class="font-medium">{{ title }}</p>
    <p v-if="hint" class="mt-1 max-w-sm text-sm text-muted">{{ hint }}</p>
    <div v-if="$slots.default" class="mt-5 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
