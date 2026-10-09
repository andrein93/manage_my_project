# mmp Reminders and Notifications — Design Spec and Plan

Date: 2026-10-09 · Status: approved to build (user asked to complete steps 4–6 without check-ins)

## Purpose

mmp knows what needs doing — overdue tasks, due dates, charges to pay or invoice, statements not
paid, domains about to expire — but today it only shows them when the user opens the Overview.
Reminders bring them to the user: a notification center in the dashboard, optional desktop
notifications from the running `mmp start`, and the same list for the CLI and the AI.

Success: a bell in the sidebar shows the number of active reminders and opens a panel listing
them (each links to the right page, can be dismissed or snoozed until tomorrow); with desktop
notifications enabled in Settings, a running mmp shows one system notification per new reminder
(at most once a day per item, grouped when several); `mmp reminders` and the `reminders` MCP
tool return the same list.

## Decisions (taken on the user's behalf)

- **Kinds:** `task_overdue`, `task_due_today`, `statement_overdue`, `charge_soon` (a charge to pay
  or a recurring fee to invoice within the next 3 days, today included), `field_date` (custom
  date field within its remind window, step 4). Project health stays on the Overview (it is not
  time-bound).
- **Stable keys:** each reminder has a key such as `task_overdue:<taskId>` or
  `charge_soon:pay:<expenseId>:<date>`; dismissing stores the key, so a reminder comes back only
  if it is a new one (a new date or a new task). Snooze hides it until the next local day.
- **Desktop notifications:** off by default (Settings → Notifications). When on, the server
  checks every 15 minutes while `mmp start` runs and notifies each reminder key at most once per
  day; three or more new reminders are grouped in one notification ("5 things need you").
  Implementation without dependencies: Windows toast through PowerShell
  (`-EncodedCommand`, no string interpolation of user text into the command), macOS
  `osascript`, Linux `notify-send`; failures are logged once and never crash the server.
- **No email** (would need SMTP credentials; out of scope).
- **Storage:** `reminder_state (key PRIMARY KEY, dismissed_at, snoozed_until, notified_on)`,
  local only.

## Core — `src/core/reminders.ts`

- `reminders(app, today): Reminder[]` — `{ key, kind, title, detail, date, href, severity: 'danger'|'warning'|'info' }`,
  minus dismissed and currently snoozed keys, sorted by severity then date. Titles are English;
  the dashboard renders its own translated text from `kind` + `params`.
- `dismiss(key)`, `snooze(key, until)`, `clearState()` for tests.
- `due for notification(today)`: active reminders whose `notified_on` is not today; `markNotified(keys, today)`.
- `src/server/notify.ts`: `buildNotifyCommand(platform, title, body)` (pure, tested) + `notify()`;
  `startServer` schedules the check when the setting is on.

## Interfaces

- HTTP: `GET /api/reminders`, `POST /api/reminders/dismiss {key}`, `POST /api/reminders/snooze {key}`;
  settings gain `notifications: { desktop: boolean }`; `POST /api/notifications/test` sends one
  test notification.
- CLI: `mmp reminders` (table), `mmp reminders dismiss <key>`.
- MCP: `reminders` tool ("what needs my attention today?").
- Dashboard: bell button with count in the sidebar (and mobile topbar) opening a panel with the
  list (icon per kind, link, Dismiss, Snooze until tomorrow); Settings card "Notifications"
  (desktop on/off + "Send a test notification"); strings in six locales.

## Tasks

1. Migration + `reminders.ts` with all kinds, dismiss/snooze, notification bookkeeping — tests.
2. `notify.ts` command builder (tests) + scheduling in `startServer` behind the setting + test route.
3. HTTP, CLI, MCP (tests; tool inventory).
4. Dashboard bell + panel + settings card + locales; browser check.
5. README; full suite; review; merge; push.
