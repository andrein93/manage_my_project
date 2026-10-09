<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { THEME_PREFERENCES, setThemePreference, themePreference, type ThemePreference } from '../theme'

const { t } = useI18n()
const icons = { dark: Moon, light: Sun }
const label = (p: ThemePreference) => t(`settings.theme${p[0].toUpperCase()}${p.slice(1)}`)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('settings.appearance') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('settings.appearanceHint') }}</p>
    <fieldset class="mt-3 inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      <legend class="sr-only">{{ t('settings.appearance') }}</legend>
      <label
        v-for="p in THEME_PREFERENCES"
        :key="p"
        class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-action"
        :class="themePreference === p ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
      >
        <input type="radio" name="theme" class="sr-only" :value="p" :checked="themePreference === p" @change="setThemePreference(p)" />
        <component :is="icons[p]" class="size-4" aria-hidden="true" />
        {{ label(p) }}
      </label>
    </fieldset>
  </section>
</template>
