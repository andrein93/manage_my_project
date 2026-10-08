<script setup lang="ts">
import { Monitor, Moon, Sun } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { THEME_PREFERENCES, setThemePreference, themePreference, type ThemePreference } from '../theme'

const { t } = useI18n()
const icons = { system: Monitor, light: Sun, dark: Moon }
const label = (p: ThemePreference) => t(`settings.theme${p[0].toUpperCase()}${p.slice(1)}`)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('settings.appearance') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('settings.appearanceHint') }}</p>
    <div class="mt-3 inline-flex rounded-lg border border-line bg-surface-2 p-0.5" role="radiogroup" :aria-label="t('settings.appearance')">
      <button
        v-for="p in THEME_PREFERENCES"
        :key="p"
        type="button"
        role="radio"
        :aria-checked="themePreference === p"
        class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
        :class="themePreference === p ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
        @click="setThemePreference(p)"
      >
        <component :is="icons[p]" class="size-4" aria-hidden="true" />
        {{ label(p) }}
      </button>
    </div>
  </section>
</template>
