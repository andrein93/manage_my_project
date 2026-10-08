<script setup lang="ts">
import NumberTicker from './effects/NumberTicker.vue'

withDefaults(defineProps<{ label: string; value: number; format?: (n: number) => string; tone?: 'default' | 'danger' | 'fresh'; hint?: string }>(), {
  tone: 'default',
})
</script>

<template>
  <div :title="hint">
    <dt class="label">{{ label }}</dt>
    <dd class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums" :class="{ 'text-danger': tone === 'danger', 'text-fresh': tone === 'fresh' }">
      <NumberTicker :value="value" :format="format" />
    </dd>
  </div>
</template>
