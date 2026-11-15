# PageCraft

PageCraft is a browser extension for Chrome and Firefox (Manifest V3) that creates dedicated CSS themes for websites. Describe the look you want and an AI model (Anthropic, OpenAI, Gemini, or a local model through Ollama/LM Studio) writes the CSS, or write it yourself in the built-in editor.

Full developer documentation and the roadmap are in [docs.html](docs.html) (open it in a browser).

## Features

- Turn PageCraft on or off and choose a global dark or light preset.
- Save named custom styles and pick one per website from the popup.
- **AI theme generation:** describe a theme, watch the CSS stream into the editor with a live preview on the site, refine it with follow-up instructions, then save.
- Providers: Anthropic, OpenAI (and OpenAI-compatible services), Google Gemini, and local OpenAI-compatible servers (Ollama, LM Studio, llama.cpp).
- Generated CSS is cleaned before use: `@import` and external `url()` references are removed so a theme can't load remote resources or leak page data.
- CSS editor with syntax highlighting, line numbers, completions, bracket pairing and an inline color picker. Shortcuts: `Ctrl+Enter` generate, `Ctrl+S` save, `Ctrl+N` new style.

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
```

### Load a build

- **Chrome:** `chrome://extensions` → Developer mode → **Load unpacked** → `.output/chrome-mv3`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `.output/firefox-mv3/manifest.json`.

## Set up an AI provider

Open the popup → **AI settings**, choose a provider, enter an API key (not needed for local models), press **Load models**, pick a model, **Test connection**, and **Save**.

For Ollama, allow extension origins and restart Ollama:

```sh
setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"   # Windows
```

## Privacy and permissions

Styles, settings and API keys are stored in the browser's local extension storage. When you press **Generate**, PageCraft sends your instructions, your current CSS (when refining) and a short page description (URL without query string, title, DOM outline, colors, fonts, CSS variables) to the provider you selected, and nothing else. It needs storage, active-tab and website access to apply themes and to reach provider APIs.

## Project information

- [docs.html](docs.html): architecture, generation pipeline, security notes, roadmap.
- [CHANGELOG.md](CHANGELOG.md): release notes.
- MIT License; see [LICENCE](LICENCE).
