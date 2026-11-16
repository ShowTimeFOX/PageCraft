# PageCraft

PageCraft is a browser extension for Chrome and Firefox (Manifest V3) that creates dedicated CSS themes for websites. Describe the look you want and an AI model (Anthropic, OpenAI, Gemini, or a local model through Ollama/LM Studio) writes the CSS, or write it yourself in the built-in editor.

Full developer documentation and the roadmap are in [docs.html](docs.html) (open it in a browser).

## Features

- Turn PageCraft on or off and choose a global dark or light preset.
- Save named custom styles and pick one per website from the popup.
- **AI theme generation:** describe a theme, watch the CSS stream into the editor with a live preview on the site, refine it with follow-up instructions, then save.
- Providers: Anthropic, OpenAI (and OpenAI-compatible services), Google Gemini, and local OpenAI-compatible servers (Ollama, LM Studio, llama.cpp).
- Generated CSS is cleaned before use: `@import` and external `url()` references are removed so a theme can't load remote resources or leak page data.
- **Palette:** every AI theme starts from design tokens (colors, fonts, shape) that you can tweak in the Palette panel without another AI call.
- **Refine and review:** follow-up instructions build on a saved conversation. **Review** checks the previewed theme's contrast (and optionally a screenshot, for vision models) and fixes problems.
- Contrast checker (WCAG AA) on the previewed page.
- Themes can also apply inside iframes and web components (shadow DOM).
- **Site rules:** apply a style to one site, a whole domain (`*.example.com`), a path, or every site. Pause PageCraft per site.
- **Import/export** themes as JSON. Imported CSS is checked for external references.
- **Optional passphrase protection** for API keys, and **token/cost estimates** before and after each request.
- Asks for website access only for the sites you enable.
- CodeMirror CSS editor with completion, search, undo, color swatches and syntax warnings. Shortcuts: `Ctrl+Enter` generate, `Ctrl+S` save, `Ctrl+N` new style.

## Development

Requires Node.js 22+.

```sh
npm install
npm run dev            # Chrome with hot reload
npm run dev:firefox    # Firefox with hot reload
npm run build          # .output/chrome-mv3
npm run build:firefox  # .output/firefox-mv3
npm run zip            # store package (zip:firefox for AMO)
npm run compile        # type-check
npm test               # unit tests
```

### Load a build

- **Chrome:** `chrome://extensions` → Developer mode → **Load unpacked** → `.output/chrome-mv3`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `.output/firefox-mv3/manifest.json`.

## First steps

1. On a website, open the PageCraft popup and press **Enable on this site** (or **Enable on all sites**). PageCraft has no website access until you do.
2. Open **Settings & themes** to set up an AI provider (below).
3. Open **CustomStyle editor**, describe a theme and press **Generate**.

## Set up an AI provider

Open the popup → **Settings & themes**, choose a provider, enter an API key (not needed for local models), press **Load models**, pick a model, **Test connection**, and **Save**.

For Ollama, allow extension origins and restart Ollama:

```sh
setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"   # Windows
```

## Privacy and permissions

Styles, settings and API keys are stored in the browser's local extension storage. When you press **Generate** or **Review**, PageCraft sends your instructions, recent conversation, your current theme (when refining), a short page description (URL without query string, title, DOM outline, colors, fonts, CSS variables), on Review a contrast report, and, only if you turn it on, a screenshot of the visible page to the provider you selected, and nothing else. PageCraft requests no website access at install. You enable sites one by one (or all at once), and each AI provider's host is requested when first used. Granted sites can be revoked in settings.

## Project information

- [docs.html](docs.html): architecture, generation pipeline, security notes, roadmap.
- [CHANGELOG.md](CHANGELOG.md): release notes.
- MIT License; see [LICENCE](LICENCE).
