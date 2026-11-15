import { browser } from "wxt/browser";
import { buildThemeMessages, THEME_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { providerInfo, streamText } from "@/lib/ai/providers";
import { extractCss, sanitizeCss } from "@/lib/ai/sanitize";
import { PREVIEW_PORT, type PageDigest, type PreviewMessage } from "@/lib/messages";
import { getAiSettings, getThemeSettings, setThemeSettings } from "@/lib/storage";
import { CssEditor } from "./code-editor";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const siteName = $<HTMLParagraphElement>("site-name");
const nameInput = $<HTMLInputElement>("style-name");
const saveButton = $<HTMLButtonElement>("save-button");
const newStyleButton = $<HTMLButtonElement>("new-style-button");
const deleteButton = $<HTMLButtonElement>("delete-button");
const previewToggle = $<HTMLInputElement>("preview-toggle");
const promptInput = $<HTMLTextAreaElement>("ai-prompt");
const generateButton = $<HTMLButtonElement>("generate-button");
const refineToggle = $<HTMLInputElement>("refine-toggle");
const providerLabel = $<HTMLSpanElement>("provider-label");
const aiSettingsButton = $<HTMLButtonElement>("ai-settings-button");
const generationProcess = $<HTMLParagraphElement>("generation-process");
const status = $<HTMLParagraphElement>("status");

const editor = new CssEditor({
  textarea: $("css-editor"),
  highlightedCode: $("highlighted-code"),
  highlightLayer: $("highlight-layer"),
  lineNumbers: $("line-numbers"),
  completionList: $("completion-list"),
  colorPicker: $("color-picker"),
});

const params = new URLSearchParams(window.location.search);
const hostname = params.get("hostname") ?? "";
const tabId = Number.parseInt(params.get("tabId") ?? "", 10);
let editingId = params.get("styleId") ?? "";
let lastPrompt = "";
let generation: AbortController | null = null;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function setStatus(message: string) {
  status.textContent = message;
}

function setProcess(message: string, isError = false) {
  generationProcess.textContent = message;
  generationProcess.classList.toggle("error", isError);
}

// --------------------------------------------------------------- live preview

let previewPort: ReturnType<typeof browser.tabs.connect> | null = null;
let previewTimer: number | undefined;

function sendPreview(message: PreviewMessage) {
  if (!Number.isInteger(tabId)) return;
  try {
    if (!previewPort) {
      previewPort = browser.tabs.connect(tabId, { name: PREVIEW_PORT });
      previewPort.onDisconnect.addListener(() => {
        previewPort = null;
      });
    }
    previewPort.postMessage(message);
  } catch {
    previewPort = null; // tab closed or content script not injected (e.g. page loaded before install)
  }
}

function schedulePreview(delay = 250) {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    sendPreview(previewToggle.checked ? { type: "set", css: editor.value } : { type: "clear" });
  }, delay);
}

editor.onChange(() => schedulePreview());
previewToggle.addEventListener("change", () => schedulePreview(0));

// ------------------------------------------------------------- style storage

function disableAll(message: string) {
  for (const control of [saveButton, newStyleButton, deleteButton, generateButton, promptInput, nameInput]) {
    control.disabled = true;
  }
  editor.setDisabled(true);
  setStatus(message);
}

async function loadStyle() {
  if (!/^[a-z0-9.-]+$/i.test(hostname)) {
    siteName.textContent = "No website selected.";
    disableAll("Open CustomStyle from a website's PageCraft popup.");
    return;
  }

  siteName.textContent = Number.isInteger(tabId) ? `For ${hostname} · previewing in its tab` : `For ${hostname}`;
  try {
    const { myStyles } = await getThemeSettings();
    const style = myStyles.find((item) => item.id === editingId);
    if (style) {
      nameInput.value = style.name;
      editor.value = style.css;
      promptInput.value = style.prompt ?? "";
      lastPrompt = style.prompt ?? "";
      deleteButton.hidden = false;
    } else {
      editingId = "";
      deleteButton.hidden = true;
    }
  } catch (error) {
    disableAll(`Could not load saved styles: ${errorMessage(error)}`);
  }
}

async function saveStyle() {
  const name = nameInput.value.trim();
  const css = editor.value.trim();
  if (!name || !css) {
    setStatus("Enter a style name and CSS before saving.");
    return;
  }

  saveButton.disabled = true;
  try {
    const { myStyles, selectedMyStyles } = await getThemeSettings();
    const index = myStyles.findIndex((style) => style.id === editingId);
    const record = { name, css, prompt: lastPrompt || undefined, updatedAt: Date.now() };
    if (index >= 0) {
      myStyles[index] = { ...myStyles[index]!, ...record };
    } else {
      editingId = crypto.randomUUID();
      myStyles.push({ id: editingId, ...record });
    }
    selectedMyStyles[hostname] = editingId;
    await setThemeSettings({ myStyles, selectedMyStyles });
    deleteButton.hidden = false;
    setStatus(`"${name}" saved and applied to ${hostname}.`);
  } catch (error) {
    setStatus(`Could not save style: ${errorMessage(error)}`);
  } finally {
    saveButton.disabled = false;
  }
}

function startNewStyle() {
  editingId = "";
  lastPrompt = "";
  nameInput.value = "";
  editor.value = "";
  deleteButton.hidden = true;
  schedulePreview(0);
  setStatus("Enter a name and CSS for your new style, or describe one and press Generate.");
  nameInput.focus();
}

async function removeStyle() {
  if (!editingId) return;
  deleteButton.disabled = true;
  try {
    const data = await getThemeSettings();
    const myStyles = data.myStyles.filter((style) => style.id !== editingId);
    const { selectedMyStyles } = data;
    for (const [site, styleId] of Object.entries(selectedMyStyles)) {
      if (styleId === editingId) delete selectedMyStyles[site];
    }
    await setThemeSettings({ myStyles, selectedMyStyles });
    startNewStyle();
    setStatus("Style deleted.");
  } catch (error) {
    setStatus(`Could not delete style: ${errorMessage(error)}`);
  } finally {
    deleteButton.disabled = false;
  }
}

// --------------------------------------------------------------- generation

async function renderProviderLabel() {
  const ai = await getAiSettings();
  const config = ai.providers[ai.activeProvider];
  providerLabel.textContent = `${providerInfo[ai.activeProvider].label}${config.model ? ` · ${config.model}` : " · no model chosen"}`;
}

async function fetchDigest(): Promise<PageDigest | null> {
  if (!Number.isInteger(tabId)) return null;
  try {
    return (await browser.tabs.sendMessage(tabId, { type: "pagecraft:get-digest" })) as PageDigest;
  } catch {
    return null;
  }
}

function setGenerating(active: boolean) {
  generateButton.textContent = active ? "Stop" : "Generate";
  generateButton.title = active ? "Stop generating" : "Generate CSS (Ctrl+Enter)";
  editor.setReadOnly(active);
  promptInput.disabled = active;
  saveButton.disabled = active;
}

async function generate() {
  if (generation) {
    generation.abort();
    return;
  }
  const instructions = promptInput.value.trim();
  if (!instructions) {
    setProcess("Describe the theme you want first.", true);
    promptInput.focus();
    return;
  }

  const previousCss = editor.value;
  generation = new AbortController();
  setGenerating(true);
  let received = "";
  try {
    const ai = await getAiSettings();
    const provider = ai.activeProvider;
    const config = ai.providers[provider];

    setProcess("Reading the page…");
    const digest = await fetchDigest();

    setProcess(`Asking ${providerInfo[provider].label}${digest ? "" : " (page details unavailable — reload the site tab for better results)"}…`);
    const stream = streamText(provider, config, {
      system: THEME_SYSTEM_PROMPT,
      messages: buildThemeMessages({
        hostname,
        instructions,
        digest,
        currentCss: refineToggle.checked ? previousCss : "",
      }),
      signal: generation.signal,
    });

    for await (const chunk of stream) {
      received += chunk;
      editor.setStreaming(extractCss(received));
      setProcess(`Generating… ${received.length.toLocaleString()} characters`);
    }

    const { css, warnings } = sanitizeCss(extractCss(received));
    if (!css.trim()) throw new Error("The model returned no CSS.");
    editor.value = css;
    lastPrompt = instructions;
    if (!nameInput.value.trim()) nameInput.value = instructions.slice(0, 60);
    schedulePreview(0);
    setProcess(
      `Generated with ${providerInfo[provider].label}. Review the preview, then Save.${warnings.length ? ` Safety fixes: ${warnings.join(" ")}` : ""}`,
      warnings.length > 0,
    );
  } catch (error) {
    const aborted = generation?.signal.aborted;
    if (aborted && received) {
      const { css } = sanitizeCss(extractCss(received));
      editor.value = css;
      schedulePreview(0);
      setProcess("Stopped. The partial result is in the editor (not saved).");
    } else {
      editor.value = previousCss;
      setProcess(aborted ? "Stopped." : `Generation failed: ${errorMessage(error)}`, !aborted);
    }
  } finally {
    generation = null;
    setGenerating(false);
  }
}

// ----------------------------------------------------------------- wiring

saveButton.addEventListener("click", saveStyle);
newStyleButton.addEventListener("click", startNewStyle);
deleteButton.addEventListener("click", removeStyle);
generateButton.addEventListener("click", generate);
aiSettingsButton.addEventListener("click", () => browser.runtime.openOptionsPage());
nameInput.addEventListener("focus", () => editor.hidePopups());
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    generate();
  }
});

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    if (!generation) saveStyle();
  } else if (key === "n") {
    event.preventDefault();
    if (!generation) startNewStyle();
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "ai" in changes) renderProviderLabel();
});

window.addEventListener("pagehide", () => previewPort?.disconnect());

renderProviderLabel();
loadStyle().then(() => schedulePreview(0));
