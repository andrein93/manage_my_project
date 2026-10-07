import { createI18n } from 'vue-i18n'
import en from './locales/en.json'

// To add a language: create locales/<code>.json with the same keys and register it here.
export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
})
