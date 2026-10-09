<script setup lang="ts">
import { Printer } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Billing, type Statement } from '../api'

// Rendered without the app chrome (route meta.bare) and always light: it is a document to print.
const props = defineProps<{ id: string }>()
const { t } = useI18n()
const statement = ref<Statement | null>(null)
const billing = ref<Billing | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    statement.value = await api.statement(props.id)
    // Drafts have no frozen snapshot yet: preview with the current details.
    if (!statement.value.snapshot) {
      billing.value = (await api.settings()).billing
      const client = await api.client(statement.value.clientId)
      clientDraft.value = { name: client.billingName || client.name, address: client.billingAddress, taxId: client.billingTaxId }
    }
    document.title = statement.value.number ?? 'Draft'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

const clientDraft = ref<{ name: string; address: string; taxId: string } | null>(null)
const lang = computed(() => statement.value?.language ?? 'en')
/** Strings in the document's language, whatever the dashboard language is. */
const tr = (key: string, params: Record<string, unknown> = {}) => t(key, params, { locale: lang.value })
const issuer = computed(() => statement.value?.snapshot?.issuer ?? (billing.value ? { ...billing.value } : null))
const client = computed(() => statement.value?.snapshot?.client ?? clientDraft.value)
const money = (cents: number) =>
  new Intl.NumberFormat(lang.value, { style: 'currency', currency: statement.value?.currency ?? 'EUR' }).format(cents / 100)
const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat(lang.value, { dateStyle: 'medium' }).format(new Date(`${iso}T12:00:00`)) : '—')
const print = () => window.print()
const qty = (n: number) => new Intl.NumberFormat(lang.value, { maximumFractionDigits: 2 }).format(n)
</script>

<template>
  <div class="print-page min-h-screen bg-[#e9e9ee] py-8 print:bg-white print:py-0">
    <p v-if="error" class="mx-auto max-w-[210mm] text-sm text-red-700" role="alert">{{ error }}</p>
    <div v-if="statement" class="mx-auto mb-4 flex max-w-[210mm] justify-end print:hidden">
      <button class="inline-flex items-center gap-2 rounded-md bg-[#16171d] px-4 py-2 text-sm font-medium text-white" @click="print">
        <Printer class="size-4" aria-hidden="true" />{{ tr('statement.printButton') }}
      </button>
    </div>

    <article
      v-if="statement"
      :lang="lang"
      class="relative mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white p-[16mm] text-[10.5pt] leading-relaxed text-[#16171d] shadow-lg print:min-h-0 print:p-0 print:shadow-none"
    >
      <div v-if="statement.status === 'draft'" class="pointer-events-none absolute inset-0 grid place-items-center text-[64pt] font-bold tracking-widest text-black/5 select-none" aria-hidden="true">
        {{ tr('statement.watermark') }}
      </div>

      <header class="mb-10 flex items-start justify-between gap-8">
        <div>
          <p class="text-[8pt] font-medium tracking-wider text-[#62646f] uppercase">{{ tr('statement.issuer') }}</p>
          <p class="mt-1 font-semibold">{{ issuer?.name }}</p>
          <p class="whitespace-pre-line text-[#3b3d46]">{{ issuer?.address }}</p>
          <p v-if="issuer?.taxId" class="text-[#3b3d46]">{{ issuer.taxId }}</p>
        </div>
        <div class="text-right">
          <p class="text-[20pt] font-semibold tracking-tight">{{ statement.number ?? tr('statement.draft') }}</p>
          <p class="text-[8.5pt] text-[#62646f]">{{ tr('statement.proforma') }}</p>
        </div>
      </header>

      <section class="mb-8 grid grid-cols-2 gap-8">
        <div>
          <p class="text-[8pt] font-medium tracking-wider text-[#62646f] uppercase">{{ tr('statement.billTo') }}</p>
          <p class="mt-1 font-semibold">{{ client?.name }}</p>
          <p class="whitespace-pre-line text-[#3b3d46]">{{ client?.address }}</p>
          <p v-if="client?.taxId" class="text-[#3b3d46]">{{ client.taxId }}</p>
        </div>
        <dl class="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 text-right">
          <dt class="text-[#62646f]">{{ tr('statement.issueDate') }}</dt>
          <dd>{{ day(statement.issueDate) }}</dd>
          <dt class="text-[#62646f]">{{ tr('statement.dueDate') }}</dt>
          <dd>{{ day(statement.dueDate) }}</dd>
          <dt class="text-[#62646f]">{{ tr('statement.period') }}</dt>
          <dd>{{ day(statement.periodFrom) }} – {{ day(statement.periodTo) }}</dd>
        </dl>
      </section>

      <table class="w-full border-collapse">
        <thead>
          <tr class="border-b-2 border-[#16171d] text-left text-[8pt] tracking-wider uppercase">
            <th class="py-2 font-medium">{{ tr('statement.description') }}</th>
            <th class="py-2 text-right font-medium">{{ tr('statement.quantity') }}</th>
            <th class="py-2 text-right font-medium">{{ tr('statement.unitPrice') }}</th>
            <th class="py-2 text-right font-medium">{{ tr('statement.amount') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in statement.lines" :key="l.id" class="border-b border-[#e3e3e8] break-inside-avoid">
            <td class="py-2 pr-4">{{ l.description }}</td>
            <td class="py-2 text-right tabular-nums">{{ qty(l.quantity) }}</td>
            <td class="py-2 text-right tabular-nums">{{ money(l.unitCents) }}</td>
            <td class="py-2 text-right tabular-nums">{{ money(l.amountCents) }}</td>
          </tr>
        </tbody>
      </table>

      <dl class="mt-6 ml-auto grid w-72 grid-cols-[1fr_auto] gap-y-1 break-inside-avoid">
        <dt class="text-[#62646f]">{{ tr('statement.subtotal') }}</dt>
        <dd class="text-right tabular-nums">{{ money(statement.subtotalCents) }}</dd>
        <dt class="text-[#62646f]">{{ tr('statement.vat', { rate: statement.vatRate }) }}</dt>
        <dd class="text-right tabular-nums">{{ money(statement.vatCents) }}</dd>
        <dt class="mt-2 border-t-2 border-[#16171d] pt-2 font-semibold">{{ tr('statement.total') }}</dt>
        <dd class="mt-2 border-t-2 border-[#16171d] pt-2 text-right text-[13pt] font-semibold tabular-nums">{{ money(statement.totalCents) }}</dd>
      </dl>

      <footer class="mt-12 space-y-2 text-[9pt] text-[#3b3d46] break-inside-avoid">
        <p v-if="statement.notes" class="whitespace-pre-line">{{ statement.notes }}</p>
        <p v-if="issuer?.iban"><span class="text-[#62646f]">{{ tr('statement.iban') }}</span> <span class="font-mono">{{ issuer.iban }}</span></p>
        <p v-if="issuer?.footer" class="whitespace-pre-line">{{ issuer.footer }}</p>
      </footer>
    </article>
  </div>
</template>

<style>
@page {
  size: A4;
  margin: 16mm;
}
@media print {
  html,
  body {
    background: #fff !important;
  }
}
</style>
