# PageCraft Project

## Purpose

PageCraft is a cross-browser (Chrome and Firefox, Manifest V3) extension that creates dedicated CSS themes for websites from user instructions, using a selectable AI provider (Anthropic, OpenAI, Gemini, or a local OpenAI-compatible server), with a hand-editing CSS editor.

## Constraints

- AI output is CSS only; never generate or execute JavaScript (MV3 remote-code policy).
- Sanitize all AI-generated CSS (`lib/ai/sanitize.ts`) before preview or save: no `@import`, no external `url()`.
- AI requests run from extension pages (editor, options), not the service worker, to avoid MV3 worker suspension during streaming.
- Store data and API keys in `storage.local` only (optionally encrypted, see `lib/vault.ts`). Network requests go only to the user-selected provider.
- No host permissions at install: website and provider access is optional and requested at runtime. Don't add `host_permissions` or static content scripts (see the hook in `wxt.config.ts`).
- User-facing strings go in `public/_locales/en/messages.json` and are used via `t()` / `data-i18n` (`lib/i18n.ts`). No `$` in messages.
- Imported themes are untrusted: sanitize them like AI output.

## Layout

- `wxt.config.ts`: manifest configuration (WXT generates the per-browser manifest).
- `entrypoints/`: `background.ts`, `content.ts`, `popup/`, `editor/`, `options/`.
- `.github/workflows/`: CI and the manual store release.
- `lib/`: storage, presets, messages, page digest, `ai/` (providers, prompt, sanitize).
- `docs.html`: developer documentation and roadmap/to-do list. Keep it updated when features land.

## Development and validation

Node.js 22+. Run `npm run compile`, `npm test`, `npm run build` and `npm run build:firefox` before committing. Run tests via `npm test` (not `npx vitest`) so the Windows drive-letter fix applies. Follow the manual smoke test in `docs.html#testing`.
