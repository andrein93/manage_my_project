# Contributing

Thanks for helping! A few ground rules keep mmp easy to install and easy to trust.

- **Local-first.** No network calls, telemetry or cloud dependencies in the core.
- **No native modules.** Installing must not require a compiler (that is why we use `node:sqlite`).
- **Never overwrite user data.** Scanners and detectors only touch detected fields.
- **Every interface stays in sync.** A new capability usually needs a core function plus its
  CLI command, API route, MCP tool and dashboard UI.
- **Strings go through i18n.** Add UI text to `web/src/locales/en.json`, never inline.
- **Tests first** for core logic (`npm test`), and `npm run typecheck` must pass.

Bigger features start with a short design note in `docs/superpowers/specs/`.
