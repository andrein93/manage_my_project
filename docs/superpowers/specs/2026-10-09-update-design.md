# mmp Update — Design Spec

Date: 2026-10-09 · Status: draft for review · Builds on: Core spec

## Purpose

Updating mmp today means `git pull`, `npm install`, then remembering to restart the
`mmp start` terminal; a forgotten restart leaves a new dashboard talking to an old API (seen on
2026-10-08: every project showed as "not on this computer"). Make updating one command and make
the running server pick up a new build by itself.

Success criteria: `mmp update` in any terminal brings a git checkout to the latest version and
rebuilds it; the `mmp start` terminal restarts its server within a few seconds with a one-line
notice; an open dashboard shows "mmp updated to vX — Reload"; a failed build never restarts the
server into broken code; an install with local changes is never modified.

## Scope

In scope: `mmp update` (git installs), a build stamp, a supervising `mmp start`, the dashboard
"new version" notice. Out of scope: start at login, npm publishing, Laragon proxy, updating the
Laravel sync server, restarting MCP processes (Claude Code owns those).

## Decisions

- **Supervisor model.** `mmp start` becomes a small parent process that runs the server as a
  child (same terminal, inherited stdio) and restarts it when the build stamp changes. Chosen over
  an HTTP "restart yourself" endpoint because a re-spawned process on Windows detaches from the
  user's terminal and its logs.
- **Build stamp as the only restart trigger.** A stamp is written only at the end of a successful
  `npm run build`, so a half-finished or failed build never triggers a restart. Manual
  `git pull && npm install` works the same as `mmp update`.
- **No silent reload of the dashboard.** It shows a persistent notice with a Reload button; an
  unsaved form is never lost.
- **CLI output stays English**, like every other command; UI strings go to all locale files.

## Build stamp

`scripts/stamp-build.mjs` runs as the last step of `npm run build` and writes `dist/build.json`:

```json
{ "id": "2026-10-09T10:12:03.512Z-k3j9", "version": "0.7.0", "builtAt": "2026-10-09T10:12:03.512Z" }
```

`id` is the ISO time plus 4 random base36 characters. `src/build-info.ts` exports
`readBuildInfo(distDir): BuildInfo | null` (null when missing or unreadable, e.g. in dev).

## `mmp update`

```
mmp update            # update and rebuild
mmp update --check    # only report whether an update is available
```

Steps, run in the package root (the folder containing `package.json` of the running mmp):

1. Inspect git: is a work tree, current branch, upstream, uncommitted changes (`git status
   --porcelain`, ignoring untracked files), `git fetch`, then ahead/behind counts against the
   upstream (`git rev-list --left-right --count HEAD...@{u}`).
2. Decide with the pure function `planUpdate(state)` in `src/core/update.ts`:

| State | Result |
|---|---|
| not a git work tree | refuse: "mmp was not installed from git; reinstall from the repository" |
| detached HEAD or no upstream | refuse: "branch <b> has no upstream; set one or update by hand" |
| uncommitted changes to tracked files | refuse: "you have local changes; commit or stash them first" |
| ahead > 0 (local commits not on the remote) | refuse: "this install has N local commits; push or reset before updating" |
| behind = 0 | up to date: "mmp X is up to date" |
| behind > 0, ahead = 0 | update: fast-forward N commits |

3. On update: `git pull --ff-only`, then `npm install` (its `prepare` script runs the build, which
   writes the stamp). Output: `Updated mmp 0.6.0 → 0.7.0 (N commits).` followed by
   `A running "mmp start" restarts by itself. Restart Claude Code sessions to use the new MCP tools.`
4. Any failing step prints the command's error and exits with code 1 without touching anything
   else; a failed `npm install` leaves the previous stamp in place, so the server keeps running
   the old build.

`--check` stops after step 2 and prints the decision (exit 0 when up to date or updatable,
1 when refused).

Git and npm are run with `execFile`/`spawn`; on Windows npm is invoked as `npm.cmd`.

## Supervising `mmp start`

- `mmp start` (parent): scans once, opens the browser once (as today), then spawns the child
  `node bin/mmp.js serve` with inherited stdio and the same environment.
- `mmp serve` (new, hidden from help): starts the HTTP server without scanning or opening the
  browser and prints the usual "Dashboard running at …" line. It can also be used directly.
- The parent polls `dist/build.json` every 2 s (`fs.watchFile`, reliable on Windows). When the
  `id` differs from the one the current child started with:
  1. print `mmp <old> → <new>: restarting…`;
  2. stop the child (`child.kill()`), wait for its exit (force after 5 s);
  3. spawn a new child; print nothing more on success (the child prints its running line).
- Crash handling: if a child exits on its own within 10 s of starting, the parent prints
  `The new build failed to start (exit code N). Waiting for the next build…` and spawns again only
  when the stamp changes. A child that exits later (any crash) is restarted once after 1 s; a
  second crash within 10 s falls back to waiting for a new stamp.
- Ctrl+C / SIGINT / SIGTERM: the parent stops the child and exits with its code.
- The restart logic is a small state machine in `src/cli/supervisor.ts`, driven by injected
  `spawn`, `readStamp` and timers so it is unit-testable.

## Dashboard notice

- `GET /api/meta` gains `build: string | null` (the stamp id the server started with).
- `web/src/update.ts` keeps the build id seen at first load; `App.vue` re-reads `/api/meta` when
  the window regains focus and every 60 s. When the id changes (and both are non-null), a
  persistent bar under the topbar shows "mmp updated to v{version}" with a "Reload" button
  (`location.reload()`).
- New strings: `update.available` ("mmp updated to v{version}"), `update.reload` ("Reload"),
  added to en, it, es, de, fr, zh.

## Testing

- `tests/update.test.ts`: every row of the `planUpdate` table, plus output formatting.
- `tests/supervisor.test.ts`: stamp change → stop then start; failure within 10 s → no respawn
  until the next stamp; a late crash → one restart; SIGINT → child stopped.
- `tests/build-info.test.ts`: valid, missing and malformed `dist/build.json`.
- Server test: `/api/meta` returns `build`.
- Manual: run `mmp start` in a terminal, run `npm run build` in another → the server restarts and
  an open dashboard shows the notice; break the build (`tsc` error) → no restart.
