import { execFile } from 'node:child_process'
import type { App } from '../core/app.js'

/** Windows' PowerShell AppUserModelID: lets a script show a toast without registering an app. */
const POWERSHELL_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** A PowerShell single-quoted string literal. */
const psString = (s: string) => `'${s.replace(/'/g, "''")}'`
const appleScriptString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * The command that shows a desktop notification. Text never reaches a shell: on Windows the
 * whole script is passed base64-encoded, on macOS as one -e argument, on Linux as plain args.
 */
export function buildNotifyCommand(platform: NodeJS.Platform, title: string, body: string): { cmd: string; args: string[] } {
  if (platform === 'win32') {
    const toast = `<toast><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual></toast>`
    const script = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
      '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
      '$doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
      `$doc.LoadXml(${psString(toast)})`,
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psString(POWERSHELL_APP_ID)}).Show([Windows.UI.Notifications.ToastNotification]::new($doc))`,
    ].join('\n')
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] }
  }
  if (platform === 'darwin') {
    return { cmd: 'osascript', args: ['-e', `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`] }
  }
  return { cmd: 'notify-send', args: ['--app-name=mmp', title, body] }
}

/** Shows a desktop notification; resolves false (never throws) when the system refuses. */
export function notify(title: string, body: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const { cmd, args } = buildNotifyCommand(platform, title, body)
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (error) => resolve(!error))
  })
}

type Send = (title: string, body: string) => Promise<boolean>

/**
 * Sends today's new reminders as desktop notifications (when enabled in Settings): one each for
 * one or two, a single grouped one for three or more. Each reminder is sent at most once a day;
 * if the system refuses, they stay pending for the next run. Returns how many were covered.
 */
export async function sendDueNotifications(app: App, today: string, send: Send = notify): Promise<number> {
  if (!app.settings.get().notifications.desktop) return 0
  const due = app.reminders.dueForNotification(today)
  if (!due.length) return 0
  if (due.length >= 3) {
    const body = due
      .slice(0, 3)
      .map((r) => r.title)
      .join('\n')
    if (!(await send(`mmp: ${due.length} things need you`, due.length > 3 ? `${body}\n…` : body))) return 0
    app.reminders.markNotified(due.map((r) => r.key), today)
    return due.length
  }
  let sent = 0
  for (const r of due) {
    if (!(await send(r.title, r.detail))) continue
    app.reminders.markNotified([r.key], today)
    sent++
  }
  return sent
}
