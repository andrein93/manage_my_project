<script setup lang="ts">
import { AnimatePresence, Motion } from 'motion-v'
import { CircleAlert, CircleCheck, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { dismissToast, toasts } from '../toasts'

const { t } = useI18n()
</script>

<template>
  <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
    <AnimatePresence>
      <Motion
        v-for="toast in toasts"
        :key="toast.id"
        layout
        :initial="{ opacity: 0, y: 12, scale: 0.98 }"
        :animate="{ opacity: 1, y: 0, scale: 1 }"
        :exit="{ opacity: 0, scale: 0.98 }"
        :transition="{ type: 'spring', stiffness: 420, damping: 32 }"
        class="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3 text-sm shadow-pop"
        :role="toast.tone === 'error' ? 'alert' : 'status'"
      >
        <CircleAlert v-if="toast.tone === 'error'" class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <CircleCheck v-else class="mt-0.5 size-4 shrink-0 text-fresh" aria-hidden="true" />
        <p class="min-w-0 flex-1 break-words">{{ toast.message }}</p>
        <button class="-m-1 rounded p-1 text-muted hover:text-ink" :aria-label="t('ui.dismiss')" @click="dismissToast(toast.id)">
          <X class="size-4" aria-hidden="true" />
        </button>
      </Motion>
    </AnimatePresence>
  </div>
</template>
