<script setup lang="ts">
import { Motion } from 'motion-v'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { reducedMotion, staggerDelay } from '../motion'
import { dayLabel, formatMinutes, formatUsd } from '../time'

const props = defineProps<{ days: { date: string; minutes: number; costUsd: number }[] }>()
const { t } = useI18n()

const HEIGHT = 180
const PAD = { top: 12, right: 8, bottom: 26, left: 36 }
const GAP = 2
const RADIUS = 4

const box = ref<HTMLElement | null>(null)
const width = ref(640)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => (width.value = Math.max(240, entry.contentRect.width)))
  if (box.value) observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

/** Rounded hour ticks covering the busiest day. */
const ticks = computed(() => {
  const maxHours = Math.max(1, ...props.days.map((d) => d.minutes / 60))
  const step = maxHours <= 4 ? 1 : maxHours <= 8 ? 2 : maxHours <= 16 ? 4 : 6
  const top = Math.ceil(maxHours / step) * step
  return Array.from({ length: top / step + 1 }, (_, i) => i * step)
})
const plot = computed(() => ({ w: width.value - PAD.left - PAD.right, h: HEIGHT - PAD.top - PAD.bottom }))
const y = (hours: number) => PAD.top + plot.value.h - (hours / ticks.value.at(-1)!) * plot.value.h
const slot = computed(() => plot.value.w / Math.max(1, props.days.length))
const barWidth = computed(() => Math.max(2, Math.min(28, slot.value - GAP)))

/** Bar path with rounded top corners, anchored to the baseline. */
function barPath(index: number, minutes: number): string {
  const x = PAD.left + index * slot.value + (slot.value - barWidth.value) / 2
  const base = y(0)
  const top = y(minutes / 60)
  const h = base - top
  if (h <= 0) return ''
  const r = Math.min(RADIUS, barWidth.value / 2, h)
  const w = barWidth.value
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`
}

/** Label every day when they fit, otherwise every n-th. */
const labelEvery = computed(() => Math.ceil(props.days.length / Math.max(1, Math.floor(plot.value.w / 44))))
const short = computed(() => props.days.length > 7)

const active = ref<number | null>(null)
const tooltip = computed(() => {
  if (active.value === null) return null
  const d = props.days[active.value]
  const x = PAD.left + active.value * slot.value + slot.value / 2
  return {
    left: Math.min(Math.max(x, 70), width.value - 70),
    top: y(d.minutes / 60),
    text: t('time.tooltip', { date: dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' }), time: formatMinutes(d.minutes), cost: formatUsd(d.costUsd) }),
  }
})
</script>

<template>
  <figure ref="box" class="relative">
    <svg :width="width" :height="HEIGHT" role="img" :aria-label="t('time.chartLabel', { from: days[0]?.date, to: days.at(-1)?.date })">
      <g aria-hidden="true">
        <g v-for="tick in ticks" :key="tick">
          <line :x1="PAD.left" :x2="width - PAD.right" :y1="y(tick)" :y2="y(tick)" class="stroke-line" :stroke-width="tick === 0 ? 1 : 0.5" />
          <text :x="PAD.left - 6" :y="y(tick)" dy="0.32em" text-anchor="end" class="fill-muted text-[11px] tabular-nums">{{ tick }}h</text>
        </g>
        <!-- Bars grow from the baseline; transform-box makes the origin the bar's own bottom edge. -->
        <Motion
          v-for="(d, i) in days"
          :key="d.date"
          as="path"
          :d="barPath(i, d.minutes)"
          class="fill-chart transition-opacity"
          :class="{ 'opacity-50': active !== null && active !== i }"
          :style="{ transformOrigin: 'bottom', transformBox: 'fill-box' }"
          :initial="reducedMotion ? false : { scaleY: 0 }"
          :animate="{ scaleY: 1 }"
          :transition="{ duration: 0.5, ease: 'easeOut', delay: staggerDelay(i, reducedMotion) }"
        />
        <text
          v-for="(d, i) in days"
          v-show="i % labelEvery === 0"
          :key="`l-${d.date}`"
          :x="PAD.left + i * slot + slot / 2"
          :y="HEIGHT - 8"
          text-anchor="middle"
          class="fill-muted text-[11px]"
        >
          {{ short ? dayLabel(d.date, { day: 'numeric' }) : dayLabel(d.date) }}
        </text>
      </g>
      <!-- Hit targets: full column height, wider than the bar. -->
      <rect
        v-for="(d, i) in days"
        :key="`h-${d.date}`"
        :x="PAD.left + i * slot"
        :y="PAD.top"
        :width="slot"
        :height="plot.h"
        fill="transparent"
        tabindex="0"
        class="outline-none focus-visible:stroke-action"
        :aria-label="t('time.tooltip', { date: d.date, time: formatMinutes(d.minutes), cost: formatUsd(d.costUsd) })"
        @mouseenter="active = i"
        @mouseleave="active = null"
        @focus="active = i"
        @blur="active = null"
      />
    </svg>
    <div
      v-if="tooltip"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-pop"
      :style="{ left: `${tooltip.left}px`, top: `${tooltip.top - 8}px` }"
    >
      {{ tooltip.text }}
    </div>
    <table class="sr-only">
      <caption>{{ t('time.perDay') }}</caption>
      <tr v-for="d in days" :key="`t-${d.date}`">
        <th scope="row">{{ d.date }}</th>
        <td>{{ formatMinutes(d.minutes) }}</td>
        <td>{{ formatUsd(d.costUsd) }}</td>
      </tr>
    </table>
  </figure>
</template>
