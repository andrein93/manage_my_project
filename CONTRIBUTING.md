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

## Adding a language

1. Copy `web/src/locales/en.json` to `web/src/locales/<code>.json` (e.g. `es.json`, `de.json`,
   `fr.json`; use a region only when needed, e.g. `pt-BR.json`).
2. Set `_meta.name` to the language's own name (`Español`, `Deutsch`, `Français`).
3. Translate every value. Keep `{placeholders}` exactly as they are, and keep the ` | `
   separators of plural forms (`"No tasks | 1 task | {n} tasks"`). Avoid `@` and `|` elsewhere:
   they have a special meaning in vue-i18n.
4. Run `npm test`: `tests/locales.test.ts` fails if a key is missing or extra, or if
   placeholders or plural forms differ from English.

The language appears in Settings → Language automatically, and is picked by default for browsers
set to it. Dates and amounts follow the chosen language.
