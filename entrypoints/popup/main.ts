import { browser } from "wxt/browser";
import { getThemeSettings, setThemeSettings, type MyStyle, type PresetId } from "@/lib/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const siteName = $<HTMLParagraphElement>("site-name");
const toggleButton = $<HTMLButtonElement>("toggle-button");
const presetSelect = $<HTMLSelectElement>("preset-select");
const myStylesSelect = $<HTMLSelectElement>("my-styles-select");
const customStyleButton = $<HTMLButtonElement>("custom-style-button");
const settingsButton = $<HTMLButtonElement>("settings-button");
const status = $<HTMLParagraphElement>("status");

let currentHostname = "";
let currentTabId: number | undefined;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function setStatus(message: string) {
  status.textContent = message;
}

function renderToggle(enabled: boolean) {
  toggleButton.setAttribute("aria-pressed", String(enabled));
  toggleButton.textContent = enabled ? "PageCraft on" : "PageCraft off";
}

function renderMyStyles(myStyles: MyStyle[], selectedId: string | undefined) {
  myStylesSelect.replaceChildren(new Option("No custom style", ""));
  for (const style of myStyles) myStylesSelect.add(new Option(style.name, style.id));
  myStylesSelect.value = selectedId ?? "";
}

async function loadPopup() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
    let url: URL | null = null;
    try {
      url = new URL(tab?.url ?? "");
    } catch {
      url = null;
    }
    const isWebPage = url?.protocol === "http:" || url?.protocol === "https:";
    currentHostname = isWebPage && url ? url.hostname : "";
    siteName.textContent = currentHostname || "Global settings apply to websites.";
    myStylesSelect.disabled = !isWebPage;
    customStyleButton.disabled = !isWebPage;

    const data = await getThemeSettings();
    renderToggle(data.enabled);
    presetSelect.value = data.preset;
    renderMyStyles(data.myStyles, currentHostname ? data.selectedMyStyles[currentHostname] : "");
  } catch (error) {
    siteName.textContent = "Could not load PageCraft settings.";
    for (const control of [toggleButton, presetSelect, myStylesSelect, customStyleButton]) control.disabled = true;
    setStatus(errorMessage(error));
  }
}

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  try {
    const enabled = toggleButton.getAttribute("aria-pressed") !== "true";
    await setThemeSettings({ enabled });
    renderToggle(enabled);
    setStatus(enabled ? "PageCraft enabled." : "PageCraft disabled.");
  } catch (error) {
    setStatus(`Could not update PageCraft: ${errorMessage(error)}`);
  } finally {
    toggleButton.disabled = false;
  }
});

presetSelect.addEventListener("change", async () => {
  presetSelect.disabled = true;
  try {
    await setThemeSettings({ preset: presetSelect.value as PresetId });
    setStatus("Global preset saved.");
  } catch (error) {
    setStatus(`Could not save preset: ${errorMessage(error)}`);
  } finally {
    presetSelect.disabled = false;
  }
});

myStylesSelect.addEventListener("change", async () => {
  if (!currentHostname) return;
  myStylesSelect.disabled = true;
  try {
    const { selectedMyStyles } = await getThemeSettings();
    if (myStylesSelect.value) selectedMyStyles[currentHostname] = myStylesSelect.value;
    else delete selectedMyStyles[currentHostname];
    await setThemeSettings({ selectedMyStyles });
    setStatus(myStylesSelect.value ? "Custom style applied to this site." : "Custom style removed from this site.");
  } catch (error) {
    setStatus(`Could not apply custom style: ${errorMessage(error)}`);
  } finally {
    myStylesSelect.disabled = false;
  }
});

customStyleButton.addEventListener("click", async () => {
  if (!currentHostname) return;
  customStyleButton.disabled = true;
  try {
    const { selectedMyStyles } = await getThemeSettings();
    const params = new URLSearchParams({
      hostname: currentHostname,
      styleId: selectedMyStyles[currentHostname] ?? "",
      tabId: String(currentTabId ?? ""),
    });
    await browser.tabs.create({ url: `${browser.runtime.getURL("/editor.html")}?${params}` });
    window.close();
  } catch (error) {
    setStatus(`Could not open the style editor: ${errorMessage(error)}`);
    customStyleButton.disabled = false;
  }
});

settingsButton.addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

loadPopup();
