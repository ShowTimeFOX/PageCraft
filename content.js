const styleElementId = "pagecraft-custom-style";
const hostname = window.location.hostname;

const presets = {
  dark: `
    :root { color-scheme: dark !important; }
    html, body { background-color: #17191c !important; color: #e8eaed !important; }
    a { color: #8ab4f8 !important; }
    input, textarea, select, button { color-scheme: dark !important; }
  `,
  light: `
    :root { color-scheme: light !important; }
    html, body { background-color: #ffffff !important; color: #202124 !important; }
    a { color: #1558d6 !important; }
    input, textarea, select, button { color-scheme: light !important; }
  `,
};

function applySettings(settings) {
  const { enabled, preset, styles, myStyles, selectedMyStyles } = settings;
  if (enabled === false) {
    document.getElementById(styleElementId)?.remove();
    return;
  }

  const selectedId = selectedMyStyles?.[hostname];
  const selectedStyle = Array.isArray(myStyles)
    ? myStyles.find((style) => style?.id === selectedId)
    : undefined;
  const presetCss = Object.prototype.hasOwnProperty.call(presets, preset)
    ? presets[preset]
    : "";
  const css = [
    presetCss,
    styles?.[hostname] ?? "",
    selectedStyle?.css ?? "",
  ].filter(Boolean).join("\n");
  let styleElement = document.getElementById(styleElementId);

  if (!css) {
    styleElement?.remove();
    return;
  }

  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = styleElementId;
    (document.head || document.documentElement).append(styleElement);
  }

  styleElement.textContent = css;
}

async function refreshSettings() {
  try {
    const settings = await chrome.storage.local.get({
      enabled: true,
      preset: "none",
      styles: {},
      myStyles: [],
      selectedMyStyles: {},
    });
    applySettings(settings);
  } catch (error) {
    console.error("PageCraft could not load saved styles.", error);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && Object.keys(changes).length > 0) {
    refreshSettings();
  }
});

refreshSettings();
