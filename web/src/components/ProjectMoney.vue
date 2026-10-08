<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Agreement, type AgreementKind, type Expense, type FinanceReport, type Interval, type Payment } from '../api'
import { useAutoRefresh, useErrors } from '../composables'
import { formatMinutes, formatMoney, localDate } from '../time'

const props = defineProps<{ projectId: string }>()
const { t } = useI18n()
const { error, report: reportError } = useErrors()

const summary = ref<FinanceReport | null>(null)
const agreements = ref<Agreement[]>([])
const payments = ref<Payment[]>([])
const expenses = ref<Expense[]>([])
const confirm = ref<string | null>(null)

const currency = computed(() => summary.value?.currency ?? 'EUR')
const money = (cents: number | null) => formatMoney(cents, currency.value)
const totals = computed(() => summary.value?.totals ?? null)
const owedCents = computed(() => (totals.value ? totals.value.earnedCents - totals.value.collectedCents : 0))

let latest = 0
async function load() {
  const request = ++latest
  const projectId = props.projectId
  try {
    const [s, a, p, e] = await Promise.all([
      api.financeReport({ lifetime: 'true', project: projectId }),
      api.agreements(projectId),
      api.payments({ project: projectId }),
      api.expenses({ project: projectId }),
    ])
    if (request !== latest || projectId !== props.projectId) return
    summary.value = s
    agreements.value = a
    payments.value = p
    expenses.value = e
    error.value = null
  } catch (err) {
    if (request === latest) reportError(err)
  }
}

async function run(action: () => Promise<unknown>) {
  try {
    await action()
    error.value = null
    await load()
  } catch (err) {
    reportError(err)
  }
}

/** Two clicks to delete, without a browser dialog. */
function removeWith(id: string, action: () => Promise<unknown>) {
  if (confirm.value !== id) {
    confirm.value = id
    setTimeout(() => confirm.value === id && (confirm.value = null), 3000)
    return
  }
  confirm.value = null
  run(action)
}

const deal = ref({ kind: 'hourly' as AgreementKind, amount: '', interval: 'month' as Interval, startDate: localDate(), endDate: '', note: '' })
const addDeal = () =>
  run(async () => {
    const d = deal.value
    await api.addAgreement({
      projectId: props.projectId,
      kind: d.kind,
      amount: d.amount,
      interval: d.kind === 'recurring' ? d.interval : undefined,
      startDate: d.startDate,
      endDate: d.endDate || null,
      note: d.note,
    })
    deal.value = { ...deal.value, amount: '', endDate: '', note: '' }
  })

const payment = ref({ amount: '', date: localDate(), note: '' })
const addPayment = () =>
  run(async () => {
    await api.addPayment({ projectId: props.projectId, ...payment.value })
    payment.value = { amount: '', date: localDate(), note: '' }
  })

const expense = ref({ amount: '', interval: '' as '' | Interval, startDate: localDate(), note: '' })
const addExpense = () =>
  run(async () => {
    const e = expense.value
    await api.addExpense({ projectId: props.projectId, amount: e.amount, interval: e.interval || null, startDate: e.startDate, note: e.note })
    expense.value = { amount: '', interval: '', startDate: localDate(), note: '' }
  })

function terms(a: Agreement): string {
  if (a.kind === 'hourly') return `${money(a.amountCents)}${t('finance.perHourSuffix')}`
  if (a.kind === 'fixed') return `${t('finance.kind.fixed')} ${money(a.amountCents)}`
  return `${money(a.amountCents)} ${t(`finance.every.${a.interval}`)}`
}

const endDeal = (id: string) => run(() => api.updateAgreement(id, { endDate: localDate() }))
const removeDeal = (id: string) => removeWith(id, () => api.removeAgreement(id))
const removePay = (id: string) => removeWith(id, () => api.removePayment(id))
const removeExp = (id: string) => removeWith(id, () => api.removeExpense(id))

watch(
  () => props.projectId,
  () => {
    summary.value = null
    load()
  },
)
useAutoRefresh(load, 60_000)
</script>

<template>
  <section>
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
      <h2 class="text-lg font-semibold">{{ t('finance.panel') }}</h2>
      <span class="text-xs text-muted">{{ t('finance.panelHint') }}</span>
    </div>
    <p v-if="error" class="mb-3 text-sm text-danger" role="alert">{{ error }}</p>

    <dl v-if="totals" class="grid grid-cols-2 gap-4 sm:grid-cols-5">
      <div>
        <dt class="label">{{ t('finance.earned') }}</dt>
        <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums">{{ money(totals.earnedCents) }}</dd>
      </div>
      <div>
        <dt class="label">{{ owedCents < 0 ? t('finance.credit') : t('finance.owed') }}</dt>
        <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums" :class="{ 'text-aging': owedCents > 0 }">{{ money(Math.abs(owedCents)) }}</dd>
      </div>
      <div>
        <dt class="label">{{ t('finance.costs') }}</dt>
        <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums">{{ money(totals.costCents) }}</dd>
      </div>
      <div>
        <dt class="label">{{ t('finance.margin') }}</dt>
        <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums" :class="{ 'text-danger': totals.marginCents < 0 }">{{ money(totals.marginCents) }}</dd>
      </div>
      <div :title="t('finance.perHourHint')">
        <dt class="label">{{ t('finance.perHour') }}</dt>
        <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums">{{ totals.effectiveRateCents === null ? '-' : money(totals.effectiveRateCents) }}</dd>
        <dd class="text-xs text-muted">{{ formatMinutes(totals.minutes) }}</dd>
      </div>
    </dl>

    <div class="mt-8 grid gap-10 lg:grid-cols-2">
      <div>
        <h3 class="label mb-2">{{ t('finance.agreements') }}</h3>
        <ul v-if="agreements.length" class="divide-y divide-line text-sm">
          <li v-for="a in agreements" :key="a.id" class="flex items-center justify-between gap-3 py-2">
            <span class="min-w-0">
              <span class="font-medium">{{ terms(a) }}</span>
              <span class="ml-2 text-xs text-muted tabular-nums">{{ a.startDate }} → {{ a.endDate ?? t('finance.ongoing') }}</span>
              <span v-if="a.note" class="block truncate text-xs text-muted">{{ a.note }}</span>
            </span>
            <span class="flex shrink-0 gap-1">
              <button v-if="!a.endDate && a.kind !== 'fixed'" class="btn btn-sm" @click="endDeal(a.id)">{{ t('finance.end') }}</button>
              <button class="btn btn-sm" :class="{ '!border-danger !text-danger': confirm === a.id }" @click="removeDeal(a.id)">
                {{ confirm === a.id ? t('finance.removeConfirm') : t('finance.remove') }}
              </button>
            </span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted">{{ t('finance.noAgreements') }}</p>
        <form class="mt-3 grid grid-cols-2 gap-2" @submit.prevent="addDeal">
          <select v-model="deal.kind" class="field" :aria-label="t('finance.kind.hourly')">
            <option v-for="k in ['hourly', 'fixed', 'recurring'] as const" :key="k" :value="k">{{ t(`finance.kind.${k}`) }}</option>
          </select>
          <input v-model="deal.amount" class="field" required inputmode="decimal" :placeholder="deal.kind === 'hourly' ? t('finance.rate') : t('finance.amount')" :aria-label="t('finance.amount')" />
          <label class="text-xs text-muted">
            {{ t('finance.from') }}
            <input v-model="deal.startDate" type="date" class="field mt-1" required />
          </label>
          <label class="text-xs text-muted">
            {{ t('finance.to') }}
            <input v-model="deal.endDate" type="date" class="field mt-1" />
          </label>
          <select v-if="deal.kind === 'recurring'" v-model="deal.interval" class="field" :aria-label="t('finance.interval')">
            <option value="month">{{ t('finance.every.month') }}</option>
            <option value="year">{{ t('finance.every.year') }}</option>
          </select>
          <input v-model="deal.note" class="field" :class="{ 'col-span-2': deal.kind !== 'recurring' }" maxlength="2000" :placeholder="t('finance.note')" :aria-label="t('finance.note')" />
          <button class="btn btn-primary col-span-2 justify-center">{{ t('finance.add') }}</button>
        </form>
      </div>

      <div class="space-y-10">
        <div>
          <h3 class="label mb-2">{{ t('finance.payments') }}</h3>
          <ul v-if="payments.length" class="divide-y divide-line text-sm">
            <li v-for="p in payments" :key="p.id" class="flex items-center justify-between gap-3 py-2">
              <span class="min-w-0">
                <span class="tabular-nums">{{ p.date }}</span>
                <span class="ml-2 text-muted">{{ p.note }}</span>
              </span>
              <span class="flex shrink-0 items-center gap-2">
                <span class="font-medium tabular-nums">{{ money(p.amountCents) }}</span>
                <button class="text-muted hover:text-danger" :class="{ '!text-danger': confirm === p.id }" :aria-label="t('finance.remove')" @click="removePay(p.id)">
                  {{ confirm === p.id ? t('finance.removeConfirm') : '×' }}
                </button>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">{{ t('finance.noPayments') }}</p>
          <form class="mt-3 grid grid-cols-[1fr_9rem] gap-2" @submit.prevent="addPayment">
            <input v-model="payment.amount" class="field" required inputmode="decimal" :placeholder="t('finance.amount')" :aria-label="t('finance.amount')" />
            <input v-model="payment.date" type="date" class="field" required :aria-label="t('finance.date')" />
            <input v-model="payment.note" class="field" maxlength="2000" :placeholder="t('finance.note')" :aria-label="t('finance.note')" />
            <button class="btn btn-primary justify-center">{{ t('finance.recordPayment') }}</button>
          </form>
        </div>

        <div>
          <h3 class="label mb-2">{{ t('finance.directExpenses') }}</h3>
          <ul v-if="expenses.length" class="divide-y divide-line text-sm">
            <li v-for="e in expenses" :key="e.id" class="flex items-center justify-between gap-3 py-2">
              <span class="min-w-0">
                <span>{{ e.note || '-' }}</span>
                <span class="ml-2 text-xs text-muted tabular-nums">{{ e.interval ? t(`finance.every.${e.interval}`) : e.startDate }}</span>
              </span>
              <span class="flex shrink-0 items-center gap-2">
                <span class="tabular-nums">{{ money(e.amountCents) }}</span>
                <button class="text-muted hover:text-danger" :class="{ '!text-danger': confirm === e.id }" :aria-label="t('finance.remove')" @click="removeExp(e.id)">
                  {{ confirm === e.id ? t('finance.removeConfirm') : '×' }}
                </button>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">{{ t('finance.noExpenses') }}</p>
          <form class="mt-3 grid grid-cols-[1fr_9rem] gap-2" @submit.prevent="addExpense">
            <input v-model="expense.note" class="field" required maxlength="2000" :placeholder="t('finance.note')" :aria-label="t('finance.note')" />
            <input v-model="expense.amount" class="field" required inputmode="decimal" :placeholder="t('finance.amount')" :aria-label="t('finance.amount')" />
            <select v-model="expense.interval" class="field" :aria-label="t('finance.interval')">
              <option value="">{{ t('finance.once') }}</option>
              <option value="month">{{ t('finance.every.month') }}</option>
              <option value="year">{{ t('finance.every.year') }}</option>
            </select>
            <input v-model="expense.startDate" type="date" class="field" required :aria-label="t('finance.date')" />
            <button class="btn btn-primary col-span-2 justify-center">{{ t('finance.addExpense') }}</button>
          </form>
        </div>
      </div>
    </div>
  </section>
</template>
