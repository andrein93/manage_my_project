<script setup lang="ts">
import { AnimatePresence, Motion } from 'motion-v'
import { AlarmClock, CalendarClock, CheckSquare, CircleAlert, Clock, FileText, Wallet, X } from 'lucide-vue-next'
import { nextTick, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Reminder } from '../api'
import { useErrors } from '../composables'
import { formatMoney } from '../time'

const props = defineProps<{ open: boolean; reminders: Reminder[] }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t } = useI18n()
const closeButton = ref<HTMLButtonElement | null>(null)
const panel = ref<{ $el: HTMLElement } | null>(null)
const busy = ref<string | null>(null)
const { error, report, clear } = useErrors()

// Modal: focus moves in on open and back to whatever opened it on close.
let opener: HTMLElement | null = null
watch(
  () => props.open,
  async (open) => {
    if (open) {
      opener = document.activeElement as HTMLElement | null
      clear()
      await nextTick()
      closeButton.value?.focus()
    } else {
      opener?.focus()
      opener = null
    }
  },
)

/** Keeps Tab inside the panel. */
function trapTab(e: KeyboardEvent) {
  const items = [...(panel.value?.$el.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])]
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

const icons: Record<Reminder['kind'], Component> = {
  task_overdue: CircleAlert,
  task_due_today: CheckSquare,
  statement_overdue: FileText,
  charge_soon: Wallet,
  field_date: CalendarClock,
}
const tones = { danger: 'text-danger', warning: 'text-aging', info: 'text-muted' }

const money = (r: Reminder) => formatMoney(Number(r.params.amountCents), String(r.params.currency || 'EUR'))

/** Translated text from the reminder's kind and raw values (the server's title is English). */
function title(r: Reminder): string {
  const p = r.params
  if (r.kind === 'charge_soon') {
    const label = String(p.label || (p.direction === 'pay' ? t('overview.defaultExpense') : t('overview.defaultFee')))
    return t(p.direction === 'pay' ? 'reminders.kinds.toPay' : 'reminders.kinds.toInvoice', { label })
  }
  if (r.kind === 'field_date') return t('reminders.kinds.fieldDate', { field: String(p.field), date: r.date })
  return t(`reminders.kinds.${r.kind}`, { task: String(p.task ?? ''), number: String(p.number ?? '') })
}
function detail(r: Reminder): string {
  const p = r.params
  if (r.kind === 'statement_overdue') return `${p.client} · ${money(r)} · ${t('reminders.due', { date: r.date })}`
  if (r.kind === 'charge_soon') return `${p.project || t('finance.sharedExpenses')} · ${money(r)} · ${r.date}`
  if (r.kind === 'field_date') {
    const days = Number(p.days)
    const when = days < 0 ? t('reminders.daysAgo', { n: -days }, -days) : days === 0 ? t('fresh.today') : t('reminders.inDays', { n: days }, days)
    return `${p.project} · ${when}`
  }
  if (r.kind === 'task_overdue') return `${p.project} · ${t('reminders.due', { date: r.date })}`
  return String(p.project)
}

async function act(r: Reminder, action: 'dismiss' | 'snooze') {
  busy.value = r.key
  clear()
  try {
    await (action === 'dismiss' ? api.dismissReminder(r.key) : api.snoozeReminder(r.key))
    emit('changed')
    // The row (and the focused button) goes away: keep focus inside the panel.
    closeButton.value?.focus()
  } catch (e) {
    report(e)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <AnimatePresence>
    <Motion
      v-if="open"
      class="fixed inset-0 z-40 bg-black/40"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      @click="emit('close')"
    />
    <Motion
      v-if="open"
      ref="panel"
      as="aside"
      role="dialog"
      aria-modal="true"
      :aria-label="t('reminders.title')"
      class="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-paper shadow-pop"
      :initial="{ x: 460 }"
      :animate="{ x: 0 }"
      :exit="{ x: 460 }"
      :transition="{ type: 'spring', stiffness: 380, damping: 38 }"
      @keydown.esc="emit('close')"
      @keydown.tab="trapTab"
    >
      <header class="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 class="text-lg font-semibold">{{ t('reminders.title') }}</h2>
        <button ref="closeButton" class="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" :aria-label="t('reminders.close')" @click="emit('close')">
          <X class="size-4" aria-hidden="true" />
        </button>
      </header>
      <p v-if="error" class="border-b border-line px-5 py-2 text-sm text-danger" role="alert">{{ error }}</p>
      <p v-if="!reminders.length" class="px-5 py-10 text-center text-sm text-muted">{{ t('reminders.empty') }}</p>
      <ul v-else class="flex-1 divide-y divide-line overflow-y-auto">
        <li v-for="r in reminders" :key="r.key" class="flex items-start gap-3 px-5 py-3.5">
          <component :is="icons[r.kind]" class="mt-0.5 size-4 shrink-0" :class="tones[r.severity]" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <RouterLink :to="r.href" class="block font-medium break-words hover:text-action" @click="emit('close')">{{ title(r) }}</RouterLink>
            <p class="mt-0.5 text-xs text-muted">{{ detail(r) }}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <button
              class="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
              :title="t('reminders.snooze')"
              :aria-label="`${t('reminders.snooze')}: ${title(r)}`"
              :disabled="busy === r.key"
              @click="act(r, 'snooze')"
            >
              <AlarmClock class="size-4" aria-hidden="true" />
            </button>
            <button
              class="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
              :title="t('reminders.dismiss')"
              :aria-label="`${t('reminders.dismiss')}: ${title(r)}`"
              :disabled="busy === r.key"
              @click="act(r, 'dismiss')"
            >
              <X class="size-4" aria-hidden="true" />
            </button>
          </div>
        </li>
      </ul>
      <footer class="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted">
        <Clock class="size-3.5" aria-hidden="true" />
        <RouterLink to="/settings" class="hover:text-ink" @click="emit('close')">{{ t('reminders.settingsLink') }}</RouterLink>
      </footer>
    </Motion>
  </AnimatePresence>
</template>
