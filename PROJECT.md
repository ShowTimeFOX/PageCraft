# PageCraft Project

## Purpose

PageCraft is a cross-browser extension for creating custom CSS styles on websites. The first release targets Chrome and Firefox using Manifest V3.

## Current scope

- Provide an extension popup with a global enable toggle and dark/light CSS presets.
- Save reusable named custom styles locally and select them per HTTP or HTTPS hostname.
- Provide a full-window CustomStyle editor with syntax highlighting, active-line highlighting, line numbers, bracket pairing, CSS property/value suggestions, inline color picking, keyboard shortcuts, and style management.
- Automatically apply global presets and selected site styles when pages load.
- Keep the manifest generator (`manifest.js`) and the browser-loadable manifest (`manifest.json`) in sync.
- Avoid network requests and keep saved styles in browser-local storage.

## Project files

- `manifest.js` generates the browser-required `manifest.json`.
- `icon.png` is used as the extension icon in browser metadata and the toolbar.
- `content.js` loads the saved style for the current hostname and updates it when local styles change.
- `popup.html`, `popup.css`, and `popup.js` implement the compact popup controls.
- `editor.html`, `editor.css`, and `editor.js` implement custom style management.
- `README.md` documents installation and basic usage in Chrome and Firefox.
- `CHANGELOG.md` records notable releases and changes.
- `LICENCE` contains the project's MIT License.

## Compatibility and permissions

The extension uses Manifest V3 APIs available in current Chrome and Firefox releases (Firefox 109+). It requires local storage, active-tab access to identify the current site, and access to websites to apply the user-authored CSS. Styles are stored only in the browser.

## Development and validation

After editing manifest configuration, run `node manifest.js` and reload the extension in the browser. Install unpacked in Chrome via `chrome://extensions`; load temporarily in Firefox via `about:debugging#/runtime/this-firefox`.

Manual smoke test:

1. Load the extension in Chrome and Firefox.
2. Choose a global preset and confirm it applies across HTTP or HTTPS pages.
3. Create a named custom style and confirm it applies to the current hostname.
4. Reload the page and confirm the preset and custom style remain applied.
5. Disable PageCraft and confirm all PageCraft styles are removed; enable it again and confirm they return.
