# PageCraft Project

## Purpose

PageCraft is a cross-browser (Chrome and Firefox, Manifest V3) extension that creates dedicated CSS themes for websites from user instructions, using a selectable AI provider (Anthropic, OpenAI, Gemini, or a local OpenAI-compatible server), with a hand-editing CSS editor.

## Constraints

- AI output is CSS only; never generate or execute JavaScript (MV3 remote-code policy).
- Sanitize all AI-generated CSS (`lib/ai/sanitize.ts`) before preview or save: no `@import`, no external `url()`.
- AI requests run from extension pages (editor, options), not the service worker, to avoid MV3 worker suspension during streaming.
- Store data and API keys in `storage.local` only. Network requests go only to the user-selected provider.

## Layout

- `wxt.config.ts`: manifest configuration (WXT generates the per-browser manifest).
- `entrypoints/`: `content.ts`, `popup/`, `editor/`, `options/`.
- `lib/`: storage, presets, messages, page digest, `ai/` (providers, prompt, sanitize).
- `docs.html`: developer documentation and roadmap/to-do list. Keep it updated when features land.

## Development and validation

Node.js 22+. Run `npm run compile`, `npm run build` and `npm run build:firefox` before committing. Follow the manual smoke test in `docs.html#testing`.
