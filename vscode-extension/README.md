# mmp — editor time (VS Code extension)

Counts the minutes you spend editing code by hand in mmp's Time page, next to the time mmp
already gets from Claude Code sessions and git commits. Overlapping minutes are never counted
twice.

## How it works

While the VS Code window is focused and you type, save or switch files, the extension tells
your local mmp server which workspace folder you are in — at most once a minute per folder.
mmp attributes the minute to the registered project containing that folder (otherwise it shows
under "Activity outside your projects"). Leaving VS Code open and idle counts nothing.

It sends only a folder path and a timestamp, only to the address in `mmp.serverUrl`
(your own computer by default). If mmp is not running, it stays quiet and tries again a few
minutes later; the status bar item (`mmp`) shows the state.

## Install

From this folder:

```bash
npm run package                      # creates mmp-time-0.1.0.vsix (downloads @vscode/vsce once)
code --install-extension mmp-time-0.1.0.vsix
```

or in VS Code: **Extensions → ⋯ → Install from VSIX…** and pick the file.

## Settings

| Setting | Default | |
|---|---|---|
| `mmp.enabled` | `true` | Turn editor time on or off. |
| `mmp.serverUrl` | `http://localhost:4477` | Your mmp dashboard address (`MMP_PORT`). |

## Other editors

Any editor can do the same with one HTTP call per active minute:

```bash
curl -X POST http://localhost:4477/api/time/heartbeat \
  -H 'content-type: application/json' \
  -d '{"path": "/absolute/path/to/project", "at": "2026-10-09T14:05:00Z"}'
```
