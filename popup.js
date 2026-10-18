const siteName = document.getElementById("site-name");
const toggleButton = document.getElementById("toggle-button");
const presetSelect = document.getElementById("preset-select");
const myStylesSelect = document.getElementById("my-styles-select");
const customStyleButton = document.getElementById("custom-style-button");
const status = document.getElementById("status");

let currentHostname = "";

function setStatus(message) {
  status.textContent = message;
}

function renderMyStyles(myStyles, selectedId) {
  myStylesSelect.replaceChildren(new Option("No custom style", ""));

  for (const style of myStyles) {
    myStylesSelect.add(new Option(style.name, style.id));
  }

  myStylesSelect.value = selectedId ?? "";
}

async function loadPopup() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? "");
    if (url.protocol === "http:" || url.protocol === "https:") {
      currentHostname = url.hostname;
      siteName.textContent = currentHostname;
      myStylesSelect.disabled = false;
      customStyleButton.disabled = false;
    } else {
      siteName.textContent = "Global settings apply to websites.";
      myStylesSelect.disabled = true;
      customStyleButton.disabled = true;
    }

    const data = await chrome.storage.local.get({
      enabled: true,
      preset: "none",
      myStyles: [],
      selectedMyStyles: {},
    });

    toggleButton.setAttribute("aria-pressed", String(data.enabled !== false));
    toggleButton.textContent = data.enabled === false ? "PageCraft off" : "PageCraft on";
    presetSelect.value = ["none", "dark", "light"].includes(data.preset)
      ? data.preset
      : "none";
    const styles = Array.isArray(data.myStyles)
      ? data.myStyles.filter((style) => style && typeof style.id === "string" && typeof style.name === "string")
      : [];
    renderMyStyles(styles, currentHostname ? data.selectedMyStyles?.[currentHostname] : "");
  } catch (error) {
    siteName.textContent = "Could not load PageCraft settings.";
    toggleButton.disabled = true;
    presetSelect.disabled = true;
    myStylesSelect.disabled = true;
    customStyleButton.disabled = true;
    setStatus(error.message);
  }
}

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  try {
    const enabled = toggleButton.getAttribute("aria-pressed") !== "true";
    await chrome.storage.local.set({ enabled });
    toggleButton.setAttribute("aria-pressed", String(enabled));
    toggleButton.textContent = enabled ? "PageCraft on" : "PageCraft off";
    setStatus(enabled ? "PageCraft enabled." : "PageCraft disabled.");
  } catch (error) {
    setStatus(`Could not update PageCraft: ${error.message}`);
  } finally {
    toggleButton.disabled = false;
  }
});

presetSelect.addEventListener("change", async () => {
  presetSelect.disabled = true;
  try {
    await chrome.storage.local.set({ preset: presetSelect.value });
    setStatus("Global preset saved.");
  } catch (error) {
    setStatus(`Could not save preset: ${error.message}`);
  } finally {
    presetSelect.disabled = false;
  }
});

myStylesSelect.addEventListener("change", async () => {
  if (!currentHostname) return;

  myStylesSelect.disabled = true;
  try {
    const { selectedMyStyles = {} } = await chrome.storage.local.get({ selectedMyStyles: {} });
    if (myStylesSelect.value) {
      selectedMyStyles[currentHostname] = myStylesSelect.value;
    } else {
      delete selectedMyStyles[currentHostname];
    }
    await chrome.storage.local.set({ selectedMyStyles });
    setStatus(myStylesSelect.value ? "Custom style applied to this site." : "Custom style removed from this site.");
  } catch (error) {
    setStatus(`Could not apply custom style: ${error.message}`);
  } finally {
    myStylesSelect.disabled = false;
  }
});

customStyleButton.addEventListener("click", async () => {
  if (!currentHostname) return;

  customStyleButton.disabled = true;
  try {
    const { selectedMyStyles = {} } = await chrome.storage.local.get({ selectedMyStyles: {} });
    const params = new URLSearchParams({
      hostname: currentHostname,
      styleId: selectedMyStyles[currentHostname] ?? "",
    });
    await chrome.tabs.create({
      url: `${chrome.runtime.getURL("editor.html")}?${params}`,
    });
  } catch (error) {
    setStatus(`Could not open the style editor: ${error.message}`);
    customStyleButton.disabled = false;
  }
});

loadPopup();
