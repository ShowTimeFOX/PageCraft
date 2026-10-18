const styleElementId = "pagecraft-custom-style";
const hostname = window.location.hostname;

function applySavedStyle(styles) {
  const css = styles?.[hostname] ?? "";
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

chrome.storage.local.get({ styles: {} }, ({ styles }) => {
  applySavedStyle(styles);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.styles) {
    applySavedStyle(changes.styles.newValue ?? {});
  }
});
