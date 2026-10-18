# PageCraft Project

## Purpose

PageCraft is a cross-browser extension for creating custom CSS styles on websites. The first release targets Chrome and Firefox using Manifest V3.

## Current scope

- Provide an extension popup for editing CSS on the current HTTP or HTTPS hostname.
- Save CSS locally, keyed by hostname, and automatically apply it when that site loads.
- Remove a site's style when the editor is saved empty.
- Keep the manifest generator (`manifest.js`) and the browser-loadable manifest (`manifest.json`) in sync.
- Avoid network requests and keep saved styles in browser-local storage.

## Project files

- `manifest.js` generates the browser-required `manifest.json`.
- `content.js` loads the saved style for the current hostname and updates it when local styles change.
- `popup.html`, `popup.css`, and `popup.js` implement the CSS editor and save flow.
- `README.md` documents installation and basic usage in Chrome and Firefox.

## Compatibility and permissions

The extension uses Manifest V3 APIs available in current Chrome and Firefox releases (Firefox 109+). It requires local storage, active-tab access to identify the current site, and access to websites to apply the user-authored CSS. Styles are stored only in the browser.

## Development and validation

After editing manifest configuration, run `node manifest.js` and reload the extension in the browser. Install unpacked in Chrome via `chrome://extensions`; load temporarily in Firefox via `about:debugging#/runtime/this-firefox`.

Manual smoke test:

1. Load the extension in Chrome and Firefox.
2. Open an HTTP or HTTPS page and save CSS that visibly changes it.
3. Confirm the style applies immediately and remains after reloading the page.
4. Open another hostname and confirm the first hostname's CSS is not applied there.
5. Clear the editor and save; confirm the style is removed.
