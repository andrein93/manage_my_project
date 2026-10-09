<script setup lang="ts">
import { ArrowDown, ArrowLeft, ArrowUp, Ban, CheckCircle2, Plus, Printer, RotateCcw, Send, Trash2, Undo2, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, type Project, type Statement } from '../api'
import { useErrors } from '../composables'
import { LANGUAGES } from '../i18n'
import { lineAmount, statementTotals } from '../statements'
import { formatMoney, localDate } from '../time'
import PageHeader from '../ui/PageHeader.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiButton from '../ui/UiButton.vue'
import UiCard from '../ui/UiCard.vue'
import UiSkeleton from '../ui/UiSkeleton.vue'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const router = useRouter()
const { error, report, clear } = useErrors()

interface EditLine {
  projectId: string
  description: string
  quantity: number
  /** Unit price in currency units (what the user types). */
  unit: number
  /** Typed amount in currency units; null = quantity × unit. */
  amount: number | null
}

const statement = ref<Statement | null>(null)
const projects = ref<Project[]>([])
const lines = ref<EditLine[]>([])
const fields = ref({ periodFrom: '', periodTo: '', vatRate: 0, language: 'en', notes: '', dueDate: '' })
const dirty = ref(false)
const saved = ref(false)
const busy = ref(false)
const confirm = ref<'refill' | 'issue' | 'void' | 'delete' | null>(null)
const paidDate = ref(localDate(new Date()))

const isDraft = computed(() => statement.value?.status === 'draft')
const money = (cents: number) => formatMoney(cents, statement.value?.currency ?? 'EUR')
const cents = (units: number) => Math.round((Number(units) || 0) * 100)
const amountOf = (l: EditLine) => (l.amount === null ? lineAmount(l.quantity, cents(l.unit)) : cents(l.amount))
const totals = computed(() => statementTotals(lines.value.map(amountOf), Number(fields.value.vatRate) || 0))

function adopt(s: Statement) {
  statement.value = s
  lines.value = s.lines.map((l) => ({
    projectId: l.projectId,
    description: l.description,
    quantity: l.quantity,
    unit: l.unitCents / 100,
    amount: l.amountCents === lineAmount(l.quantity, l.unitCents) ? null : l.amountCents / 100,
  }))
  fields.value = { periodFrom: s.periodFrom, periodTo: s.periodTo, vatRate: s.vatRate, language: s.language, notes: s.notes, dueDate: s.dueDate ?? '' }
  dirty.value = false
  confirm.value = null
}

async function load() {
  try {
    const s = await api.statement(props.id)
    adopt(s)
    projects.value = (await api.client(s.clientId)).projects
  } catch (e) {
    report(e)
  }
}
watch(() => props.id, load, { immediate: true })
watch([lines, fields], () => (dirty.value = true), { deep: true, flush: 'sync' })

/** Runs an action, then shows the statement it returns. */
async function act(fn: () => Promise<Statement | void>) {
  busy.value = true
  clear()
  try {
    const result = await fn()
    if (result) adopt(result)
  } catch (e) {
    report(e)
  } finally {
    busy.value = false
  }
}

/** Saves fields and lines; throws on failure so issue/refill never run on stale lines. */
async function persist(): Promise<Statement> {
  const s = statement.value!
  await api.updateStatement(s.id, {
    periodFrom: fields.value.periodFrom,
    periodTo: fields.value.periodTo,
    vatRate: Number(fields.value.vatRate) || 0,
    language: fields.value.language,
    notes: fields.value.notes,
    dueDate: fields.value.dueDate || null,
  })
  const result = await api.setStatementLines(
    s.id,
    lines.value.map((l) => ({ projectId: l.projectId, description: l.description, quantity: Number(l.quantity), unitCents: cents(l.unit), amountCents: amountOf(l) })),
  )
  saved.value = true
  setTimeout(() => (saved.value = false), 2500)
  return result
}

const save = () => act(persist)

function twoClick(kind: 'refill' | 'issue' | 'void' | 'delete', run: () => void) {
  if (confirm.value !== kind) {
    confirm.value = kind
    return
  }
  confirm.value = null
  run()
}

/** Unsaved edits are saved first; if that fails, nothing else happens (the error is shown). */
const refill = () =>
  twoClick('refill', () =>
    act(async () => {
      if (dirty.value) await persist()
      return api.refillStatement(props.id)
    }),
  )
const issue = () =>
  twoClick('issue', () =>
    act(async () => {
      if (dirty.value) await persist()
      return api.issueStatement(props.id)
    }),
  )
const markPaid = () => act(() => api.markStatementPaid(props.id, paidDate.value))
const markUnpaid = () => act(() => api.markStatementUnpaid(props.id))
const voidIt = () => twoClick('void', () => act(() => api.voidStatement(props.id)))
const remove = () =>
  twoClick('delete', () =>
    act(async () => {
      await api.removeStatement(props.id)
      router.push({ name: 'client', params: { id: statement.value!.clientId } })
    }),
  )

function addLine() {
  lines.value.push({ projectId: projects.value[0]?.id ?? '', description: '', quantity: 1, unit: 0, amount: null })
}
function moveLine(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= lines.value.length) return
  const copy = [...lines.value]
  ;[copy[i], copy[j]] = [copy[j], copy[i]]
  lines.value = copy
}

const tone = computed(() => {
  const s = statement.value
  if (!s) return 'neutral'
  return s.overdue ? 'danger' : ({ draft: 'neutral', issued: 'accent', paid: 'fresh', void: 'dormant' } as const)[s.status]
})
const statusLabel = computed(() => (statement.value?.overdue ? t('statement.status.overdue') : t(`statement.status.${statement.value?.status}`)))
const printHref = computed(() => router.resolve({ name: 'statement-print', params: { id: props.id } }).href)
</script>

<template>
  <section>
    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <div v-if="!statement && !error" class="space-y-4">
      <UiSkeleton class="h-8 w-1/3" />
      <UiSkeleton class="h-48" />
    </div>

    <template v-if="statement">
      <PageHeader :title="statement.number ?? t('statement.draft')" :subtitle="`${statement.clientName} · ${t('statement.periodLabel', { from: statement.periodFrom, to: statement.periodTo })}`">
        <template #before>
          <RouterLink :to="{ name: 'client', params: { id: statement.clientId } }" class="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft class="size-3.5" aria-hidden="true" /> {{ statement.clientName }}
          </RouterLink>
        </template>
        <template #actions>
          <UiBadge :tone="tone">{{ statusLabel }}</UiBadge>
          <a :href="printHref" target="_blank" rel="noopener" class="btn"><Printer class="size-4" aria-hidden="true" />{{ t('statement.print') }}</a>
        </template>
      </PageHeader>

      <!-- Draft: editable -->
      <template v-if="isDraft">
        <UiCard class="mb-4 grid gap-3 p-5 sm:grid-cols-3 lg:grid-cols-6">
          <label class="block">
            <span class="label mb-1.5 block">{{ t('time.from') }}</span>
            <input v-model="fields.periodFrom" type="date" class="field" />
          </label>
          <label class="block">
            <span class="label mb-1.5 block">{{ t('time.to') }}</span>
            <input v-model="fields.periodTo" type="date" class="field" />
          </label>
          <label class="block">
            <span class="label mb-1.5 block">{{ t('statement.vatRate') }}</span>
            <input v-model.number="fields.vatRate" type="number" min="0" max="100" step="0.1" class="field" />
          </label>
          <label class="block">
            <span class="label mb-1.5 block">{{ t('statement.dueDate') }}</span>
            <input v-model="fields.dueDate" type="date" class="field" />
          </label>
          <label class="block sm:col-span-2">
            <span class="label mb-1.5 block">{{ t('statement.language') }}</span>
            <select v-model="fields.language" class="field">
              <option v-for="l in LANGUAGES" :key="l.code" :value="l.code" :lang="l.code">{{ l.name }}</option>
            </select>
          </label>
          <label class="block sm:col-span-3 lg:col-span-6">
            <span class="label mb-1.5 block">{{ t('statement.notes') }}</span>
            <textarea v-model="fields.notes" class="field min-h-16" maxlength="5000" />
          </label>
        </UiCard>

        <UiCard class="mb-4 overflow-x-auto p-5">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="label">{{ t('statement.lines') }}</h2>
            <UiButton size="sm" :icon="RotateCcw" :class="{ '!border-danger !text-danger': confirm === 'refill' }" :disabled="busy" @click="refill">
              {{ confirm === 'refill' ? t('statement.refillConfirm') : t('statement.refill') }}
            </UiButton>
          </div>
          <p v-if="!lines.length" class="py-6 text-center text-sm text-muted">{{ t('statement.emptyLines') }}</p>
          <table v-else class="w-full min-w-[46rem] text-sm">
            <thead class="text-left text-xs tracking-wider text-muted uppercase">
              <tr>
                <th class="w-40 pr-2 pb-2 font-medium">{{ t('statement.project') }}</th>
                <th class="pr-2 pb-2 font-medium">{{ t('statement.description') }}</th>
                <th class="w-20 pr-2 pb-2 text-right font-medium">{{ t('statement.quantity') }}</th>
                <th class="w-28 pr-2 pb-2 text-right font-medium">{{ t('statement.unitPrice') }}</th>
                <th class="w-28 pr-2 pb-2 text-right font-medium">{{ t('statement.amount') }}</th>
                <th class="w-24 pb-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in lines" :key="i" class="align-top">
                <td class="py-1 pr-2">
                  <select v-model="l.projectId" class="field" :aria-label="t('statement.project')">
                    <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
                  </select>
                </td>
                <td class="py-1 pr-2"><input v-model="l.description" class="field" maxlength="500" :aria-label="t('statement.description')" /></td>
                <td class="py-1 pr-2">
                  <input v-model.number="l.quantity" type="number" min="0" step="0.01" class="field text-right" :aria-label="t('statement.quantity')" @input="l.amount = null" />
                </td>
                <td class="py-1 pr-2">
                  <input v-model.number="l.unit" type="number" step="0.01" class="field text-right" :aria-label="t('statement.unitPrice')" @input="l.amount = null" />
                </td>
                <td class="py-1 pr-2">
                  <input
                    :value="(amountOf(l) / 100).toFixed(2)"
                    type="number"
                    step="0.01"
                    class="field text-right"
                    :aria-label="t('statement.amount')"
                    @change="l.amount = Number(($event.target as HTMLInputElement).value)"
                  />
                </td>
                <td class="py-1 whitespace-nowrap">
                  <button type="button" class="rounded p-1.5 text-muted hover:text-ink" :aria-label="t('statement.moveUp')" @click="moveLine(i, -1)"><ArrowUp class="size-4" aria-hidden="true" /></button>
                  <button type="button" class="rounded p-1.5 text-muted hover:text-ink" :aria-label="t('statement.moveDown')" @click="moveLine(i, 1)"><ArrowDown class="size-4" aria-hidden="true" /></button>
                  <button type="button" class="rounded p-1.5 text-muted hover:text-danger" :aria-label="t('statement.removeLine')" @click="lines.splice(i, 1)"><X class="size-4" aria-hidden="true" /></button>
                </td>
              </tr>
            </tbody>
          </table>
          <UiButton class="mt-3" size="sm" :icon="Plus" :disabled="!projects.length" @click="addLine">{{ t('statement.addLine') }}</UiButton>
        </UiCard>
      </template>

      <!-- Issued, paid or void: read-only -->
      <UiCard v-else class="mb-4 overflow-x-auto p-5">
        <dl class="mb-4 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt class="label">{{ t('statement.issueDate') }}</dt><dd class="mt-1 font-mono">{{ statement.issueDate }}</dd></div>
          <div><dt class="label">{{ t('statement.dueDate') }}</dt><dd class="mt-1 font-mono" :class="{ 'text-danger': statement.overdue }">{{ statement.dueDate }}</dd></div>
          <div v-if="statement.paidDate"><dt class="label">{{ t('statement.status.paid') }}</dt><dd class="mt-1 font-mono">{{ statement.paidDate }}</dd></div>
        </dl>
        <table class="w-full min-w-[36rem] text-sm">
          <thead class="border-b border-line text-left text-xs tracking-wider text-muted uppercase">
            <tr>
              <th class="py-2 font-medium">{{ t('statement.description') }}</th>
              <th class="py-2 text-right font-medium">{{ t('statement.quantity') }}</th>
              <th class="py-2 text-right font-medium">{{ t('statement.unitPrice') }}</th>
              <th class="py-2 text-right font-medium">{{ t('statement.amount') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="l in statement.lines" :key="l.id">
              <td class="py-2.5 pr-3">{{ l.description }}</td>
              <td class="py-2.5 text-right tabular-nums">{{ l.quantity }}</td>
              <td class="py-2.5 text-right tabular-nums">{{ money(l.unitCents) }}</td>
              <td class="py-2.5 text-right tabular-nums">{{ money(l.amountCents) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="statement.notes" class="mt-4 text-sm whitespace-pre-line text-muted">{{ statement.notes }}</p>
      </UiCard>

      <!-- Totals and actions -->
      <UiCard class="flex flex-wrap items-end justify-between gap-6 p-5">
        <dl class="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          <dt class="text-muted">{{ t('statement.subtotal') }}</dt>
          <dd class="text-right tabular-nums">{{ money(isDraft ? totals.subtotalCents : statement.subtotalCents) }}</dd>
          <dt class="text-muted">{{ t('statement.vat', { rate: isDraft ? fields.vatRate : statement.vatRate }) }}</dt>
          <dd class="text-right tabular-nums">{{ money(isDraft ? totals.vatCents : statement.vatCents) }}</dd>
          <dt class="font-semibold">{{ t('statement.total') }}</dt>
          <dd class="text-right text-lg font-semibold tabular-nums">{{ money(isDraft ? totals.totalCents : statement.totalCents) }}</dd>
        </dl>

        <div class="flex flex-wrap items-center gap-2">
          <template v-if="isDraft">
            <span v-if="saved" class="text-sm text-fresh" role="status">{{ t('statement.saved') }}</span>
            <span v-else-if="dirty" class="text-sm text-muted">{{ t('statement.unsaved') }}</span>
            <UiButton :icon="Trash2" variant="danger" :class="{ '!border-danger': confirm === 'delete' }" :disabled="busy" @click="remove">
              {{ confirm === 'delete' ? t('statement.deleteConfirm') : t('statement.delete') }}
            </UiButton>
            <UiButton :disabled="busy || !dirty" @click="save">{{ t('statement.save') }}</UiButton>
            <UiButton variant="primary" :icon="Send" :disabled="busy || !lines.length" :title="t('statement.issueHint')" @click="issue">
              {{ confirm === 'issue' ? t('statement.issueConfirm') : t('statement.issue') }}
            </UiButton>
          </template>
          <template v-else-if="statement.status === 'issued'">
            <UiButton :icon="Ban" variant="danger" :class="{ '!border-danger': confirm === 'void' }" :disabled="busy" @click="voidIt">
              {{ confirm === 'void' ? t('statement.voidConfirm') : t('statement.void') }}
            </UiButton>
            <input v-model="paidDate" type="date" class="field !w-auto" :aria-label="t('statement.paidOn', { date: '' })" />
            <UiButton variant="primary" :icon="CheckCircle2" :disabled="busy" @click="markPaid">{{ t('statement.markPaid') }}</UiButton>
          </template>
          <template v-else-if="statement.status === 'paid'">
            <span class="text-sm text-fresh">{{ t('statement.paidOn', { date: statement.paidDate }) }}</span>
            <UiButton :icon="Undo2" :disabled="busy" @click="markUnpaid">{{ t('statement.markUnpaid') }}</UiButton>
          </template>
        </div>
      </UiCard>
    </template>
  </section>
</template>
