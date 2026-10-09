import Module, { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Loads extension.js with a minimal fake `vscode` module, to check the event wiring end to end.
const require = createRequire(import.meta.url)
type Listener = (arg: unknown) => void

function fakeVscode(focused = true) {
  const listeners: Record<string, Listener[]> = {}
  const on = (name: string) => (fn: Listener) => {
    ;(listeners[name] ??= []).push(fn)
    return { dispose() {} }
  }
  const settings: Record<string, unknown> = { enabled: true, serverUrl: 'http://localhost:9999/' }
  const status = { text: '', tooltip: '', command: '', show() {}, dispose() {} }
  const vscode = {
    StatusBarAlignment: { Right: 2 },
    window: {
      state: { focused },
      createStatusBarItem: () => status,
      onDidChangeActiveTextEditor: on('activeEditor'),
      showInformationMessage: () => undefined,
    },
    workspace: {
      getConfiguration: () => ({ get: (k: string, d: unknown) => settings[k] ?? d }),
      getWorkspaceFolder: (uri: { fsPath: string }) => (uri.fsPath.startsWith('/w/shop') ? { uri: { fsPath: '/w/shop' } } : undefined),
      onDidChangeTextDocument: on('change'),
      onDidSaveTextDocument: on('save'),
      onDidChangeConfiguration: on('config'),
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
  }
  const fire = (name: string, arg: unknown) => listeners[name]?.forEach((fn) => fn(arg))
  return { vscode, fire, status, settings }
}

function load(fake: ReturnType<typeof fakeVscode>) {
  const original = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load
  ;(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (request: unknown, ...rest: unknown[]) {
    if (request === 'vscode') return fake.vscode
    return original.call(this, request, ...rest)
  }
  try {
    const path = require.resolve('../vscode-extension/extension.js')
    delete require.cache[path]
    return require(path) as { activate: (ctx: { subscriptions: unknown[] }) => void }
  } finally {
    ;(Module as unknown as { _load: unknown })._load = original
  }
}

const doc = (fsPath: string, scheme = 'file') => ({ uri: { fsPath, scheme } })

afterEach(() => vi.unstubAllGlobals())

describe('VS Code extension wiring', () => {
  it('posts the workspace folder of an edited file to the configured server', async () => {
    const calls: { url: string; body: { path: string; at: string } }[] = []
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { ok: true, status: 204 }
    })
    const fake = fakeVscode()
    load(fake).activate({ subscriptions: [] })
    fake.fire('change', { document: doc('/w/shop/src/app.ts'), contentChanges: [{}] })
    fake.fire('change', { document: doc('/w/shop/src/other.ts'), contentChanges: [{}] }) // same folder, same minute
    // A workspace holding several projects: the file's own folder decides the project.
    fake.fire('change', { document: doc('/w/all/blog/index.php'), contentChanges: [{}] })
    fake.fire('change', { document: doc('untitled', 'untitled'), contentChanges: [{}] }) // not a file
    fake.fire('change', { document: doc('/w/shop/x.ts'), contentChanges: [] }) // no edit
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('http://localhost:9999/api/time/heartbeat')
    expect(calls.map((c) => c.body.path.split('\\').join('/'))).toEqual(['/w/shop/src', '/w/all/blog'])
    expect(Number.isNaN(Date.parse(calls[0].body.at))).toBe(false)
  })

  it('sends nothing when VS Code is not focused or the setting is off', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const unfocused = fakeVscode(false)
    load(unfocused).activate({ subscriptions: [] })
    unfocused.fire('save', doc('/w/shop/a.ts'))
    const off = fakeVscode(true)
    off.settings.enabled = false
    load(off).activate({ subscriptions: [] })
    off.fire('save', doc('/w/shop/a.ts'))
    await new Promise((r) => setTimeout(r, 0))
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('VS Code extension manifest', () => {
  const manifest = require('../vscode-extension/package.json') as {
    engines: { vscode: string }
    extensionKind?: string[]
    contributes: { configuration: { properties: Record<string, { default: unknown }> } }
  }
  it('targets VS Code with global fetch, runs locally and talks to 127.0.0.1', () => {
    expect(manifest.engines.vscode).toBe('^1.82.0')
    expect(manifest.extensionKind).toEqual(['ui'])
    expect(manifest.contributes.configuration.properties['mmp.serverUrl'].default).toBe('http://127.0.0.1:4477')
  })
})
