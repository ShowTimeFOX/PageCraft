# PageCraft

PageCraft is a lightweight browser extension for writing and saving custom CSS for individual websites. It supports Chrome and Firefox with Manifest V3.

## Features

- Turn PageCraft on or off and choose a global dark or light mode preset.
- Select reusable named custom styles per website from the popup.
- Create and edit named styles in the CustomStyle editor.
- Edit in a full-window CSS workspace with syntax highlighting, active-line highlighting, and line numbers.
- Use `Ctrl+S` / `Cmd+S` to save, `Ctrl+N` / `Cmd+N` for a new style, and `Tab` / `Shift+Tab` to indent or outdent.
- Automatically close and pair brackets and quotes; get CSS property/value suggestions and an inline color picker beside color values.
- Styles and settings are saved in browser-local storage and automatically reapplied.
- CSS is stored locally in the browser; PageCraft does not send it anywhere.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this project folder.
4. Open a website, select the PageCraft toolbar button, choose a preset or custom style, or open **CustomStyle editor** to create one.

## Install in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on…**.
3. Choose this project's `manifest.json`.
4. Open a website, select the PageCraft toolbar button, choose a preset or custom style, or open **CustomStyle editor** to create one.

Temporary Firefox add-ons are removed when Firefox restarts. For a permanent installation, package and sign the extension through Mozilla Add-ons.

## Regenerate the browser manifest

Browsers require a file named `manifest.json`. The requested `manifest.js` is its dependency-free source generator. After changing the manifest configuration, run:

```sh
node manifest.js
```

Then reload the unpacked extension in the browser.

## Permissions

PageCraft uses local storage for saved CSS and settings, the active-tab permission to identify the website open in its popup, and access to websites so its content script can apply saved styles. It only reads and writes the CSS that you enter.

## Project information

- See [CHANGELOG.md](CHANGELOG.md) for release notes.
- PageCraft is distributed under the MIT License; see [LICENCE](LICENCE).
