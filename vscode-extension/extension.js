'use strict'

const path = require('node:path')
const vscode = require('vscode')
const { createHeartbeat } = require('./heartbeat.js')

/**
 * The edited file's own folder: mmp credits the deepest registered project containing it, which
 * also works when the workspace holds many projects (e.g. C:\laragon\www). Local files only.
 */
function folderOf(document) {
  if (!document || document.uri.scheme !== 'file') return null
  return path.dirname(document.uri.fsPath)
}

function settings() {
  const config = vscode.workspace.getConfiguration('mmp')
  return { enabled: config.get('enabled', true), serverUrl: String(config.get('serverUrl', 'http://127.0.0.1:4477')).replace(/\/+$/, '') }
}

async function send(folder) {
  const { serverUrl } = settings()
  const response = await fetch(`${serverUrl}/api/time/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: folder, at: new Date().toISOString() }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`mmp answered ${response.status}`)
}

/** @param {import('vscode').ExtensionContext} context */
function activate(context) {
  const heartbeat = createHeartbeat({ send })
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10)
  status.command = 'mmp.showStatus'

  const refresh = () => {
    const { enabled, serverUrl } = settings()
    const state = enabled ? heartbeat.status() : 'disabled'
    status.text = state === 'offline' ? '$(clock) mmp $(debug-disconnect)' : '$(clock) mmp'
    status.tooltip = {
      ok: 'mmp is counting your editing time',
      idle: 'mmp: waiting for editing activity',
      offline: `mmp is not reachable at ${serverUrl} — is "mmp start" running?`,
      disabled: 'mmp editor time is turned off (setting mmp.enabled)',
    }[state]
    status.show()
  }

  const onActivity = (document) => {
    if (!settings().enabled || !vscode.window.state.focused) return
    if (heartbeat.activity(folderOf(document))) setTimeout(refresh, 1500)
  }

  context.subscriptions.push(
    status,
    vscode.workspace.onDidChangeTextDocument((e) => e.contentChanges.length && onActivity(e.document)),
    vscode.workspace.onDidSaveTextDocument(onActivity),
    vscode.window.onDidChangeActiveTextEditor((editor) => editor && onActivity(editor.document)),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('mmp') && refresh()),
    vscode.commands.registerCommand('mmp.showStatus', () => vscode.window.showInformationMessage(String(status.tooltip))),
  )
  refresh()
}

function deactivate() {}

module.exports = { activate, deactivate }
