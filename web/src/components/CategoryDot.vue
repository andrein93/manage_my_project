<script setup lang="ts">
import type { CategoryRef } from '../api'

defineProps<{ category: CategoryRef | null; showName?: boolean; reserve?: boolean }>()
</script>

<template>
  <span v-if="category" class="inline-flex min-w-0 items-center gap-1.5" :title="category.name">
    <span class="size-2.5 shrink-0 rounded-full ring-1 ring-line" :style="{ backgroundColor: category.color }" aria-hidden="true" />
    <span v-if="showName" class="truncate">{{ category.name }}</span>
    <span v-else class="sr-only">{{ category.name }}</span>
  </span>
  <span v-else-if="reserve" class="inline-block h-2.5 w-2.5 shrink-0" aria-hidden="true" />
</template>
