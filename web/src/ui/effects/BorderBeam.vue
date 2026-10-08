<!-- Place inside a `relative` rounded element. -->
<script setup lang="ts">
import { finePointer, reducedMotion } from '../../motion'
</script>

<template>
  <div v-if="finePointer && !reducedMotion" class="border-beam" aria-hidden="true" />
</template>
