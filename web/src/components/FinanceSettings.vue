<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type AiPlan, type AiPlanKind, type Expense, type Interval } from '../api'
import { useErrors } from '../composables'
import { formatMoney, localDate } from '../time'

const { t } = useI18n()
const { error, report } = useErrors()

const currency = ref('EUR')
const usdRate = ref(1)
const saved = ref(false)
const plans = ref<AiPlan[]>([])
const shared = ref<Expense[]>([])
const confirm = ref<string | null>(null)

const money = (cents: number | null) => formatMoney(cents, currency.value)

async function load() {
  const [s, p, e] = await Promise.all([api.settings(), api.aiPlans(), api.expenses({ shared: 'true' })])
  currency.value = s.currency
  usdRate.value = s.usdRate
  plans.value = p
  shared.value = e
}

async function run(action: () => Promise<unknown>) {
  try {
    await action()
    error.value = null
    await load()
  } catch (e) {
    report(e)
  }
}

function removeWith(id: string, action: () => Promise<unknown>) {
  if (confirm.value !== id) {
    confirm.value = id
    return
  }
  confirm.value = null
  run(action)
}

const saveCurrency = () =>
  run(async () => {
    await api.updateSettings({ currency: currency.value, usdRate: Number(usdRate.value) })
    saved.value = true
    setTimeout(() => (saved.value = false), 3000)
  })

const plan = ref({ kind: 'subscription' as AiPlanKind, monthlyAmount: '', startDate: localDate() })
const addPlan = () =>
  run(async () => {
    await api.addAiPlan({
      kind: plan.value.kind,
      monthlyAmount: plan.value.kind === 'subscription' ? plan.value.monthlyAmount : null,
      startDate: plan.value.startDate,
    })
    plan.value.monthlyAmount = ''
  })

const expense = ref({ note: '', amount: '', interval: 'month' as '' | Interval, startDate: localDate() })
const addShared = () =>
  run(async () => {
    const e = expense.value
    await api.addExpense({ projectId: null, amount: e.amount, interval: e.interval || null, startDate: e.startDate, note: e.note })
    expense.value = { note: '', amount: '', interval: 'month', startDate: localDate() }
  })

const endPlan = (id: string) => run(() => api.updateAiPlan(id, { endDate: localDate() }))
const removePlan = (id: string) => removeWith(id, () => api.removeAiPlan(id))
const removeShared = (id: string) => removeWith(id, () => api.removeExpense(id))

onMounted(() => load().catch(report))
</script>

<template>
  <section class="space-y-10">
    <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>

    <div>
      <h2 class="text-lg font-semibold">{{ t('app.finance') }}</h2>
      <form class="mt-3 grid gap-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end" @submit.prevent="saveCurrency">
        <label class="block">
          <span class="mb-1.5 block text-sm font-medium">{{ t('finance.currency') }}</span>
          <input v-model="currency" class="field uppercase" maxlength="3" required />
        </label>
        <label class="block">
          <span class="mb-1.5 block text-sm font-medium">{{ t('finance.usdRate', { currency }) }}</span>
          <input v-model.number="usdRate" type="number" step="0.0001" min="0.0001" class="field" required />
        </label>
        <div class="flex items-center gap-3">
          <button class="btn">{{ t('finance.saveCurrency') }}</button>
          <span v-if="saved" class="text-sm text-fresh" role="status">{{ t('detail.saved') }}</span>
        </div>
      </form>
      <p class="mt-1 text-xs text-muted">{{ t('finance.usdRateHint') }}</p>
    </div>

    <div>
      <h2 class="text-lg font-semibold">{{ t('finance.aiPlans') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('finance.aiPlansHint') }}</p>
      <ul v-if="plans.length" class="mt-3 divide-y divide-line text-sm">
        <li v-for="p in plans" :key="p.id" class="flex items-center justify-between gap-3 py-2">
          <span>
            <span class="font-medium">{{ p.kind === 'api' ? t('finance.api') : `${t('finance.subscription')} ${money(p.monthlyCents)}` }}</span>
            <span class="ml-2 text-xs text-muted tabular-nums">{{ p.startDate }} → {{ p.endDate ?? t('finance.ongoing') }}</span>
          </span>
          <span class="flex gap-1">
            <button v-if="!p.endDate" class="btn btn-sm" @click="endPlan(p.id)">{{ t('finance.end') }}</button>
            <button class="btn btn-sm" :class="{ '!border-danger !text-danger': confirm === p.id }" @click="removePlan(p.id)">
              {{ confirm === p.id ? t('finance.removeConfirm') : t('finance.remove') }}
            </button>
          </span>
        </li>
      </ul>
      <p v-else class="mt-3 text-sm text-muted">{{ t('finance.noPlans') }}</p>
      <form class="mt-3 grid gap-2 sm:grid-cols-[12rem_1fr_10rem_auto]" @submit.prevent="addPlan">
        <select v-model="plan.kind" class="field" :aria-label="t('finance.aiPlans')">
          <option value="subscription">{{ t('finance.subscription') }}</option>
          <option value="api">{{ t('finance.api') }}</option>
        </select>
        <input v-if="plan.kind === 'subscription'" v-model="plan.monthlyAmount" class="field" required inputmode="decimal" :placeholder="t('finance.monthly')" :aria-label="t('finance.monthly')" />
        <span v-else />
        <input v-model="plan.startDate" type="date" class="field" required :aria-label="t('finance.from')" />
        <button class="btn btn-primary">{{ t('finance.add') }}</button>
      </form>
    </div>

    <div>
      <h2 class="text-lg font-semibold">{{ t('finance.sharedExpenses') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('finance.sharedHint') }}</p>
      <ul v-if="shared.length" class="mt-3 divide-y divide-line text-sm">
        <li v-for="e in shared" :key="e.id" class="flex items-center justify-between gap-3 py-2">
          <span>
            <span class="font-medium">{{ e.note || '-' }}</span>
            <span class="ml-2 text-xs text-muted">{{ money(e.amountCents) }} {{ e.interval ? t(`finance.every.${e.interval}`) : e.startDate }}</span>
          </span>
          <button class="btn btn-sm" :class="{ '!border-danger !text-danger': confirm === e.id }" @click="removeShared(e.id)">
            {{ confirm === e.id ? t('finance.removeConfirm') : t('finance.remove') }}
          </button>
        </li>
      </ul>
      <form class="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_9rem_10rem_auto]" @submit.prevent="addShared">
        <input v-model="expense.note" class="field" required maxlength="2000" :placeholder="t('finance.note')" :aria-label="t('finance.note')" />
        <input v-model="expense.amount" class="field" required inputmode="decimal" :placeholder="t('finance.amount')" :aria-label="t('finance.amount')" />
        <select v-model="expense.interval" class="field" :aria-label="t('finance.interval')">
          <option value="">{{ t('finance.once') }}</option>
          <option value="month">{{ t('finance.every.month') }}</option>
          <option value="year">{{ t('finance.every.year') }}</option>
        </select>
        <input v-model="expense.startDate" type="date" class="field" required :aria-label="t('finance.date')" />
        <button class="btn btn-primary">{{ t('finance.add') }}</button>
      </form>
    </div>
  </section>
</template>
