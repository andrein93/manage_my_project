<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type CommandDoc, type ToolDoc } from '../api'
import { useErrors } from '../composables'

const { t, tm, rt } = useI18n()
const { error, report } = useErrors()

const tab = ref<'cli' | 'ai'>('cli')
const search = ref('')
const cli = ref<CommandDoc[]>([])
const mcp = ref<ToolDoc[]>([])
const mcpCommand = ref('')
const copied = ref<string | null>(null)

onMounted(async () => {
  try {
    const [help, meta] = await Promise.all([api.help(), api.meta()])
    cli.value = help.cli
    mcp.value = help.mcp
    mcpCommand.value = meta.mcpCommand
  } catch (e) {
    report(e)
  }
})

const matches = (...texts: string[]) => {
  const q = search.value.trim().toLowerCase()
  return !q || texts.some((s) => s.toLowerCase().includes(q))
}

/** CLI commands grouped by their top-level command, filtered by the search box. */
const groups = computed(() => {
  const map = new Map<string, { description: string; commands: CommandDoc[] }>()
  for (const c of cli.value) {
    if (!matches(c.command, c.description, ...c.options.map((o) => `${o.flags} ${o.description}`))) continue
    const g = map.get(c.group) ?? { description: c.groupDescription, commands: [] }
    g.commands.push(c)
    map.set(c.group, g)
  }
  return [...map]
})
const tools = computed(() => mcp.value.filter((tool) => matches(tool.name, tool.description, ...tool.params.map((p) => `${p.name} ${p.description}`))))
const examples = computed(() => (tm('commands.example') as unknown[]).map((m) => rt(m as never)))

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => copied.value === text && (copied.value = null), 2000)
  } catch {
    // Clipboard unavailable (e.g. insecure context): the text stays selectable.
  }
}
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('commands.title') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('commands.hint') }}</p>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-sm" role="tablist">
        <button
          v-for="id in ['cli', 'ai'] as const"
          :key="id"
          type="button"
          role="tab"
          class="rounded-md px-3 py-1 transition-colors"
          :class="tab === id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
          :aria-selected="tab === id"
          @click="tab = id"
        >
          {{ t(`commands.${id}`) }}
        </button>
      </div>
      <input v-model="search" type="search" class="field flex-1 sm:!w-72 sm:flex-none" :placeholder="t('commands.search')" :aria-label="t('commands.search')" />
    </div>

    <!-- CLI -->
    <div v-if="tab === 'cli'" class="mt-4 space-y-6" role="tabpanel">
      <div v-for="[name, group] in groups" :key="name">
        <h3 class="label">
          mmp {{ name }} <span class="font-normal text-muted">{{ group.commands.length > 1 ? group.description : '' }}</span>
        </h3>
        <ul class="mt-1 divide-y divide-line">
          <li v-for="c in group.commands" :key="c.command" class="py-2.5">
            <div class="flex items-start justify-between gap-3">
              <code class="font-mono text-sm break-all">{{ c.usage }}</code>
              <button class="shrink-0 text-xs text-muted hover:text-ink" @click="copy(c.command)">
                {{ copied === c.command ? t('commands.copied') : t('commands.copy') }}
              </button>
            </div>
            <p class="mt-0.5 text-sm text-muted">{{ c.description }}</p>
            <details v-if="c.options.length" class="mt-1 text-sm">
              <summary class="cursor-pointer text-xs text-muted hover:text-ink">{{ t('commands.options') }} ({{ c.options.length }})</summary>
              <dl class="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(10rem,auto)_1fr]">
                <template v-for="o in c.options" :key="o.flags">
                  <dt class="font-mono text-xs">{{ o.flags }}</dt>
                  <dd class="text-xs text-muted">
                    {{ o.description }}
                    <template v-if="o.choices">({{ t('commands.choices', { list: o.choices.join(', ') }) }})</template>
                  </dd>
                </template>
              </dl>
            </details>
          </li>
        </ul>
      </div>
      <p v-if="!groups.length" class="text-sm text-muted">{{ t('commands.noResults') }}</p>
    </div>

    <!-- AI -->
    <div v-else class="mt-4 space-y-6" role="tabpanel">
      <div>
        <h3 class="label">{{ t('commands.setup') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ t('commands.setupHint') }}</p>
        <div class="mt-2 flex items-start gap-2">
          <pre class="flex-1 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-sm">{{ mcpCommand }}</pre>
          <button class="btn shrink-0" @click="copy(mcpCommand)">{{ copied === mcpCommand ? t('commands.copied') : t('commands.copy') }}</button>
        </div>
      </div>
      <div>
        <h3 class="label">{{ t('commands.examples') }}</h3>
        <ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
          <li v-for="e in examples" :key="e">{{ e }}</li>
        </ul>
      </div>
      <ul class="divide-y divide-line">
        <li v-for="tool in tools" :key="tool.name" class="py-2.5">
          <code class="font-mono text-sm">{{ tool.name }}</code>
          <p class="mt-0.5 text-sm text-muted">{{ tool.description }}</p>
          <details v-if="tool.params.length" class="mt-1">
            <summary class="cursor-pointer text-xs text-muted hover:text-ink">{{ t('commands.params') }} ({{ tool.params.length }})</summary>
            <dl class="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(10rem,auto)_1fr]">
              <template v-for="p in tool.params" :key="p.name">
                <dt class="font-mono text-xs">
                  {{ p.name }}<span v-if="p.required" class="text-danger" :title="t('commands.required')">*</span>
                </dt>
                <dd class="text-xs text-muted">{{ p.type }}<template v-if="p.description">: {{ p.description }}</template></dd>
              </template>
            </dl>
          </details>
        </li>
      </ul>
      <p v-if="!tools.length" class="text-sm text-muted">{{ t('commands.noResults') }}</p>
    </div>
  </section>
</template>
