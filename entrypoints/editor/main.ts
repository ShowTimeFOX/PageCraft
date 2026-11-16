import { browser } from "wxt/browser";
import { buildThemeMessages, parseThemeResponse, REVIEW_INSTRUCTION, THEME_SYSTEM_PROMPT, type ThemeImage } from "@/lib/ai/prompt";
import { estimateCost, estimateInputTokens, formatCost, formatTokens, TYPICAL_OUTPUT_TOKENS } from "@/lib/ai/estimate";
import { providerInfo, streamText, validateConfig, type Usage } from "@/lib/ai/providers";
import { sanitizeCss } from "@/lib/ai/sanitize";
import type { ContrastReport } from "@/lib/contrast";
import { describeVersion, saveWithHistory } from "@/lib/history";
import { localizePage } from "@/lib/i18n";
import { PREVIEW_PORT, type PageDigest, type PreviewMessage } from "@/lib/messages";
import { requestProviderAccess } from "@/lib/permissions";
import { findRule, setHostRule } from "@/lib/rules";
import { captureTab } from "@/lib/screenshot";
import {
  getAiSettings,
  getThemeSettings,
  setThemeSettings,
  type AiSettings,
  type ConversationTurn,
  type StyleVersion,
} from "@/lib/storage";
import { ensureContentScript } from "@/lib/tabs";
import { stripTokenBlock, stripTokenDeclarations, tokensFromCss, withTokenBlock } from "@/lib/tokens";
import { unlockVault } from "@/lib/vault";
import { CssEditor } from "./code-editor";
import { PalettePanel } from "./palette";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const siteName = $<HTMLParagraphElement>("site-name");
const nameInput = $<HTMLInputElement>("style-name");
const historySelect = $<HTMLSelectElement>("history-select");
const paletteButton = $<HTMLButtonElement>("palette-button");
const paletteElement = $<HTMLElement>("palette-panel");
const saveButton = $<HTMLButtonElement>("save-button");
const newStyleButton = $<HTMLButtonElement>("new-style-button");
const deleteButton = $<HTMLButtonElement>("delete-button");
const previewToggle = $<HTMLInputElement>("preview-toggle");
const promptInput = $<HTMLTextAreaElement>("ai-prompt");
const generateButton = $<HTMLButtonElement>("generate-button");
const reviewButton = $<HTMLButtonElement>("review-button");
const undoGenerationButton = $<HTMLButtonElement>("undo-generation-button");
const refineToggle = $<HTMLInputElement>("refine-toggle");
const screenshotToggle = $<HTMLInputElement>("screenshot-toggle");
const providerLabel = $<HTMLSpanElement>("provider-label");
const aiSettingsButton = $<HTMLButtonElement>("ai-settings-button");
const chat = $<HTMLDetailsElement>("chat");
const chatSummary = $<HTMLElement>("chat-summary");
const chatLog = $<HTMLOListElement>("chat-log");
const clearChatButton = $<HTMLButtonElement>("clear-chat-button");
const generationProcess = $<HTMLParagraphElement>("generation-process");
const contrastButton = $<HTMLButtonElement>("contrast-button");
const contrastReportElement = $<HTMLDivElement>("contrast-report");
const status = $<HTMLParagraphElement>("status");
const estimateLabel = $<HTMLSpanElement>("estimate");
const unlockDialog = $<HTMLDialogElement>("unlock-dialog");
const unlockForm = $<HTMLFormElement>("unlock-form");
const unlockPass = $<HTMLInputElement>("unlock-pass");
const unlockError = $<HTMLParagraphElement>("unlock-error");
const unlockCancel = $<HTMLButtonElement>("unlock-cancel");

localizePage();

const editor = new CssEditor($("code-editor"), "/* Write custom CSS here, or describe a theme above and press Generate */");

const params = new URLSearchParams(window.location.search);
const hostname = params.get("hostname") ?? "";
const tabId = Number.parseInt(params.get("tabId") ?? "", 10);
const hasTab = Number.isInteger(tabId);
let editingId = params.get("styleId") ?? "";
let lastPrompt = "";
let generation: AbortController | null = null;
/** Cached so Generate can request host permission synchronously inside the click. */
let aiSettings: AiSettings | null = null;
/** CSS snapshots taken before each generation or loaded version (newest last). */
const undoStack: { css: string; prompt: string }[] = [];
let savedHistory: StyleVersion[] = [];
let conversation: ConversationTurn[] = [];
let lastContrast: ContrastReport | null = null;
/** Digest cached for the request estimate; refreshed on each generation. */
let cachedDigest: PageDigest | null = null;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function setStatus(message: string) {
  status.textContent = message;
}

function setProcess(message: string, isError = false) {
  generationProcess.textContent = message;
  generationProcess.classList.toggle("error", isError);
}

// Per-viewer convenience only; the page works without storage.
const SCREENSHOT_KEY = "pagecraft.sendScreenshot";
try {
  screenshotToggle.checked = localStorage.getItem(SCREENSHOT_KEY) === "1";
} catch {
  // storage unavailable
}
screenshotToggle.addEventListener("change", () => {
  try {
    localStorage.setItem(SCREENSHOT_KEY, screenshotToggle.checked ? "1" : "0");
  } catch {
    // ignore
  }
});

// --------------------------------------------------------------- live preview

let previewPort: ReturnType<typeof browser.tabs.connect> | null = null;
let previewTimer: number | undefined;
/** Resolves once the site tab has a live content script (injected if needed). */
let tabReady: Promise<boolean> = hasTab ? ensureContentScript(tabId) : Promise.resolve(false);

async function sendPreview(message: PreviewMessage) {
  if (!hasTab) return;
  if (!previewPort) {
    if (!(await tabReady)) return;
    try {
      previewPort = browser.tabs.connect(tabId, { name: PREVIEW_PORT, frameId: 0 });
      previewPort.onDisconnect.addListener(() => {
        previewPort = null;
        // The tab navigated or reloaded; re-check before the next preview.
        tabReady = ensureContentScript(tabId);
      });
    } catch {
      previewPort = null;
      return;
    }
  }
  try {
    previewPort.postMessage(message);
  } catch {
    previewPort = null;
  }
}

function schedulePreview(delay = 250) {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    void sendPreview(previewToggle.checked ? { type: "set", css: editor.value } : { type: "clear" });
    scheduleContrast();
  }, delay);
}

editor.onChange(() => {
  schedulePreview();
  schedulePaletteSync();
});
previewToggle.addEventListener("change", () => schedulePreview(0));

// ----------------------------------------------------------------- contrast

let contrastTimer: number | undefined;

function scheduleContrast(delay?: number) {
  if (!hasTab) return;
  // Back off on heavy pages: a slow scan means the next one waits longer.
  delay ??= (lastContrast?.durationMs ?? 0) > 100 ? 4000 : 1500;
  window.clearTimeout(contrastTimer);
  contrastTimer = window.setTimeout(() => void runContrast(), delay);
}

async function runContrast(): Promise<ContrastReport | null> {
  if (!hasTab || !(await tabReady)) return null;
  try {
    const report = (await browser.tabs.sendMessage(tabId, { type: "pagecraft:contrast" }, { frameId: 0 })) as ContrastReport | null;
    lastContrast = report ?? null;
  } catch {
    lastContrast = null;
  }
  renderContrast();
  return lastContrast;
}

function renderContrast() {
  const report = lastContrast;
  contrastButton.hidden = !report;
  if (!report) {
    contrastReportElement.hidden = true;
    return;
  }
  const ok = report.issues.length === 0;
  contrastButton.textContent = ok ? `Contrast ✓ (${report.checked})` : `Contrast: ${report.failing} issue${report.failing === 1 ? "" : "s"}`;
  contrastButton.classList.toggle("ok", ok);
  contrastButton.classList.toggle("bad", !ok);
  contrastButton.title = report.truncated
    ? "Partial check: the page is large, so only the first part was measured. Click for details."
    : "Check text contrast on the previewed page";

  contrastReportElement.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent = ok
    ? `All ${report.checked} visible text elements meet WCAG AA.`
    : `${report.failing} of ${report.checked} visible text elements fail WCAG AA. Press Review to let the AI fix them.`;
  contrastReportElement.append(intro);
  if (!ok) {
    const list = document.createElement("ul");
    for (const issue of report.issues) {
      const item = document.createElement("li");
      const swatch = (color: string) => {
        const span = document.createElement("span");
        span.className = "swatch";
        span.style.background = color;
        return span;
      };
      const code = document.createElement("code");
      code.textContent = issue.selector;
      item.append(
        swatch(issue.color),
        swatch(issue.background),
        ` ${issue.ratio.toFixed(2)}:1 (needs ${issue.required}:1) `,
        code,
        issue.count > 1 ? ` ×${issue.count}` : "",
      );
      list.append(item);
    }
    contrastReportElement.append(list);
  }
}

contrastButton.addEventListener("click", () => {
  const open = contrastReportElement.hidden;
  contrastReportElement.hidden = !open;
  contrastButton.setAttribute("aria-expanded", String(open));
  if (open) void runContrast();
});

// ------------------------------------------------------------------ palette

const palette = new PalettePanel(paletteElement, {
  onChange(tokens, first) {
    if (first) snapshot();
    editor.value = withTokenBlock(editor.value, tokens);
    schedulePreview(120);
  },
  onCreate(tokens) {
    snapshot();
    editor.replace(withTokenBlock(editor.value, tokens));
    palette.render(tokens);
    schedulePreview(0);
  },
});

let paletteTimer: number | undefined;

function schedulePaletteSync() {
  if (paletteElement.hidden) return;
  window.clearTimeout(paletteTimer);
  paletteTimer = window.setTimeout(() => {
    if (!palette.isEditing) palette.render(tokensFromCss(editor.value));
  }, 400);
}

paletteButton.addEventListener("click", () => {
  const open = paletteElement.hidden;
  paletteElement.hidden = !open;
  paletteButton.setAttribute("aria-pressed", String(open));
  if (open) palette.render(tokensFromCss(editor.value));
});

// ------------------------------------------------------------ conversation

function renderConversation() {
  chat.hidden = conversation.length === 0;
  chatSummary.textContent = `Conversation (${conversation.length})`;
  chatLog.replaceChildren(
    ...conversation.flatMap((turn) => {
      const you = document.createElement("li");
      you.className = "you";
      you.textContent = `You: ${turn.instruction}`;
      const ai = document.createElement("li");
      ai.className = "ai";
      ai.textContent = `AI: ${turn.summary || "Updated the theme."}`;
      return [you, ai];
    }),
  );
  chatLog.scrollTop = chatLog.scrollHeight;
}

clearChatButton.addEventListener("click", () => {
  conversation = [];
  renderConversation();
  setStatus("Conversation cleared. The next generation starts without earlier instructions (Save to keep this).");
});

// ------------------------------------------------------------ undo & history

function renderUndo() {
  undoGenerationButton.hidden = undoStack.length === 0;
  undoGenerationButton.textContent = undoStack.length > 1 ? `Undo (${undoStack.length})` : "Undo";
}

function snapshot() {
  undoStack.push({ css: editor.value, prompt: lastPrompt });
  if (undoStack.length > 30) undoStack.shift();
  renderUndo();
}

function undoGeneration() {
  const previous = undoStack.pop();
  if (!previous || generation) return;
  editor.replace(previous.css);
  lastPrompt = previous.prompt;
  afterContentReplaced();
  renderUndo();
  setProcess("Restored the previous CSS (not saved yet).");
}

function renderHistory() {
  historySelect.replaceChildren(new Option(savedHistory.length ? `History (${savedHistory.length})` : "History", ""));
  savedHistory.forEach((version, index) => historySelect.add(new Option(describeVersion(version), String(index))));
  historySelect.disabled = savedHistory.length === 0;
  historySelect.value = "";
}

historySelect.addEventListener("change", () => {
  const version = savedHistory[Number(historySelect.value)];
  historySelect.value = "";
  if (!version || generation) return;
  snapshot();
  editor.replace(version.css);
  lastPrompt = version.prompt ?? "";
  afterContentReplaced();
  setStatus(`Loaded the version from ${describeVersion(version)}. Save to keep it, or Undo to go back.`);
});

/** After a programmatic replace: refresh preview and palette. */
function afterContentReplaced() {
  schedulePreview(0);
  if (!paletteElement.hidden) palette.render(tokensFromCss(editor.value));
}

// ------------------------------------------------------------- style storage

function disableAll(message: string) {
  for (const control of [saveButton, newStyleButton, deleteButton, generateButton, reviewButton, promptInput, nameInput, historySelect]) {
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

  siteName.textContent = hasTab ? `For ${hostname} · previewing in its tab` : `For ${hostname}`;
  try {
    const { myStyles } = await getThemeSettings();
    const style = myStyles.find((item) => item.id === editingId);
    if (style) {
      nameInput.value = style.name;
      editor.value = style.css;
      lastPrompt = style.prompt ?? "";
      savedHistory = style.history ?? [];
      conversation = style.conversation ?? [];
      deleteButton.hidden = false;
    } else {
      editingId = "";
      savedHistory = [];
      conversation = [];
      deleteButton.hidden = true;
    }
    renderHistory();
    renderConversation();
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
    const { myStyles, siteRules } = await getThemeSettings();
    const index = myStyles.findIndex((style) => style.id === editingId);
    if (index < 0) editingId = crypto.randomUUID();
    const saved = saveWithHistory(myStyles[index], {
      id: editingId,
      name,
      css,
      prompt: lastPrompt || undefined,
      updatedAt: Date.now(),
      conversation: conversation.slice(-20),
    });
    if (index >= 0) myStyles[index] = saved;
    else myStyles.push(saved);
    // Apply to this site unless a rule (e.g. a pattern or global theme) already applies this style here.
    const applied = findRule(siteRules, hostname);
    const rules = applied?.styleId === editingId ? siteRules : setHostRule(siteRules, hostname, editingId, () => crypto.randomUUID());
    await setThemeSettings({ myStyles, siteRules: rules });
    savedHistory = saved.history ?? [];
    renderHistory();
    deleteButton.hidden = false;
    setStatus(`"${name}" saved and applied to ${hostname}.`);
  } catch (error) {
    setStatus(`Could not save style: ${errorMessage(error)}`);
  } finally {
    saveButton.disabled = false;
  }
}

function startNewStyle() {
  if (editor.value.trim()) snapshot();
  editingId = "";
  lastPrompt = "";
  nameInput.value = "";
  editor.replace("");
  savedHistory = [];
  conversation = [];
  renderHistory();
  renderConversation();
  deleteButton.hidden = true;
  afterContentReplaced();
  setStatus("Enter a name and CSS for your new style, or describe one and press Generate.");
  nameInput.focus();
}

async function removeStyle() {
  if (!editingId) return;
  if (!window.confirm(`Delete "${nameInput.value.trim() || "this style"}" and its saved history?`)) return;
  deleteButton.disabled = true;
  try {
    const data = await getThemeSettings();
    const myStyles = data.myStyles.filter((style) => style.id !== editingId);
    const siteRules = data.siteRules.filter((rule) => rule.styleId !== editingId);
    await setThemeSettings({ myStyles, siteRules });
    startNewStyle();
    setStatus("Style deleted. Undo restores its CSS into the editor.");
  } catch (error) {
    setStatus(`Could not delete style: ${errorMessage(error)}`);
  } finally {
    deleteButton.disabled = false;
  }
}

// --------------------------------------------------------------- generation

async function loadAiSettings() {
  aiSettings = await getAiSettings();
  const config = aiSettings.providers[aiSettings.activeProvider];
  const locked = Boolean(aiSettings.vault) && providerInfo[aiSettings.activeProvider].needsKey && !config.apiKey;
  providerLabel.textContent = `${providerInfo[aiSettings.activeProvider].label}${config.model ? ` · ${config.model}` : " · no model chosen"}${locked ? " · 🔒 locked" : ""}`;
  scheduleEstimate();
}

async function fetchDigest(): Promise<PageDigest | null> {
  if (!hasTab || !(await tabReady)) return null;
  try {
    const digest = (await browser.tabs.sendMessage(
      tabId,
      { type: "pagecraft:get-digest", size: aiSettings?.digestSize ?? "normal" },
      { frameId: 0 },
    )) as PageDigest | null;
    cachedDigest = digest ?? cachedDigest;
    return digest;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- estimate

let estimateTimer: number | undefined;

function scheduleEstimate() {
  window.clearTimeout(estimateTimer);
  estimateTimer = window.setTimeout(renderEstimate, 300);
}

/** Approximate size (and cost, if the user entered prices) of the next Generate request. */
function renderEstimate() {
  if (!aiSettings) return;
  const provider = aiSettings.activeProvider;
  const config = aiSettings.providers[provider];
  const refine = refineToggle.checked;
  const messages = buildThemeMessages({
    hostname,
    instructions: promptInput.value || " ",
    digest: cachedDigest,
    currentTokens: refine ? tokensFromCss(editor.value) : null,
    currentCss: refine ? stripTokenBlock(editor.value) : "",
    history: refine ? conversation : [],
    screenshot: screenshotToggle.checked && hasTab ? { mediaType: "image/jpeg", data: "" } : null,
  });
  const input = estimateInputTokens(provider, THEME_SYSTEM_PROMPT, messages, [{ width: 1280, height: 800 }]);
  const cost = estimateCost(config, input, TYPICAL_OUTPUT_TOKENS);
  estimateLabel.textContent = `≈ ${formatTokens(input)} in + ~${formatTokens(TYPICAL_OUTPUT_TOKENS)} out${cost !== null ? ` · ≈ ${formatCost(cost)}` : ""}`;
}

function describeUsage(usage: Usage): string {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return "";
  const config = aiSettings!.providers[aiSettings!.activeProvider];
  const cost = estimateCost(config, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
  return ` Used ${formatTokens(usage.inputTokens ?? 0)} in / ${formatTokens(usage.outputTokens ?? 0)} out tokens${cost !== null ? ` (≈ ${formatCost(cost)})` : ""}.`;
}

promptInput.addEventListener("input", scheduleEstimate);
refineToggle.addEventListener("change", scheduleEstimate);
screenshotToggle.addEventListener("change", scheduleEstimate);

// ------------------------------------------------------------ vault unlock

function openUnlock() {
  unlockError.textContent = "";
  unlockPass.value = "";
  unlockDialog.showModal();
}

unlockCancel.addEventListener("click", () => unlockDialog.close());
unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!aiSettings?.vault) {
    unlockDialog.close();
    return;
  }
  try {
    await unlockVault(aiSettings.vault, unlockPass.value);
    unlockDialog.close();
    await loadAiSettings();
    setProcess("Keys unlocked for this browser session. Press Generate again.");
  } catch (error) {
    unlockError.textContent = errorMessage(error);
  }
});

function setGenerating(active: boolean) {
  generateButton.textContent = active ? "Stop" : "Generate";
  generateButton.title = active ? "Stop generating" : "Generate CSS (Ctrl+Enter)";
  reviewButton.disabled = active;
  editor.setReadOnly(active);
  promptInput.disabled = active;
  saveButton.disabled = active;
  historySelect.disabled = active || savedHistory.length === 0;
  undoGenerationButton.disabled = active;
  paletteElement.inert = active;
}

interface GenerationOptions {
  review: boolean;
}

/** Must be called directly from a user gesture: it requests host permission before awaiting. */
function startGeneration(options: GenerationOptions = { review: false }) {
  if (generation) {
    generation.abort();
    return;
  }
  const typed = promptInput.value.trim();
  if (options.review && !editor.value.trim()) {
    setProcess("There's no theme to review yet. Generate or write one first.", true);
    return;
  }
  if (!options.review && !typed) {
    setProcess("Describe the theme you want first.", true);
    promptInput.focus();
    return;
  }
  if (!aiSettings) {
    setProcess("Settings are still loading, try again in a moment.", true);
    return;
  }
  const provider = aiSettings.activeProvider;
  const config = aiSettings.providers[provider];
  if (aiSettings.vault && providerInfo[provider].needsKey && !config.apiKey) {
    openUnlock();
    return;
  }
  const problem = validateConfig(provider, config);
  if (problem) {
    setProcess(`${problem} Open Settings to finish setting up ${providerInfo[provider].label}.`, true);
    return;
  }
  const access = requestProviderAccess(config.baseUrl);
  const instructions = options.review ? (typed ? `${REVIEW_INSTRUCTION}\nAlso: ${typed}` : REVIEW_INSTRUCTION) : typed;
  void generate(instructions, options, access);
}

async function generate(instructions: string, options: GenerationOptions, access: Promise<boolean>) {
  const settings = aiSettings!;
  const provider = settings.activeProvider;
  const config = settings.providers[provider];
  const previousCss = editor.value;
  const refine = options.review || refineToggle.checked;
  const currentTokens = refine ? tokensFromCss(previousCss) : null;
  const wantScreenshot = screenshotToggle.checked && hasTab;
  generation = new AbortController();
  setGenerating(true);
  let received = "";
  let snapshotTaken = false;
  const usage: Usage = {};
  try {
    if (!(await access)) {
      throw new Error(`PageCraft needs permission to contact ${new URL(config.baseUrl).host}. Allow it when the browser asks.`);
    }

    setProcess("Reading the page…");
    if (options.review && previewToggle.checked) await sendPreview({ type: "set", css: previousCss });
    const digest = await fetchDigest();
    const contrast = options.review ? await runContrast() : null;
    let screenshot: ThemeImage | null = null;
    if (wantScreenshot) {
      setProcess("Taking a screenshot of the site tab…");
      try {
        screenshot = await captureTab(tabId);
      } catch (error) {
        setProcess(`Screenshot failed (${errorMessage(error)}); continuing without it…`);
      }
    }

    setProcess(`Asking ${providerInfo[provider].label}${digest ? "" : " (page details unavailable; reload the site tab for better results)"}…`);
    const stream = streamText(provider, config, {
      system: THEME_SYSTEM_PROMPT,
      messages: buildThemeMessages({
        hostname,
        instructions,
        digest,
        currentTokens,
        currentCss: refine ? stripTokenBlock(previousCss) : "",
        history: refine ? conversation : [],
        screenshot,
        contrast,
      }),
      maxTokens: 12000,
      signal: generation.signal,
      onUsage: (next) => {
        if (next.inputTokens !== undefined) usage.inputTokens = next.inputTokens;
        if (next.outputTokens !== undefined) usage.outputTokens = next.outputTokens;
      },
    });

    let shownTokens = false;
    for await (const chunk of stream) {
      if (!snapshotTaken) {
        undoStack.push({ css: previousCss, prompt: lastPrompt });
        snapshotTaken = true;
      }
      received += chunk;
      const partial = parseThemeResponse(received);
      if (partial.tokens && !shownTokens) {
        shownTokens = true;
        if (!paletteElement.hidden) palette.render(partial.tokens);
      }
      editor.setStreaming(partial.css || "/* designing the palette… */\n");
      setProcess(`Generating… ${received.length.toLocaleString()} characters${partial.tokens ? ` · palette “${partial.tokens.name}”` : ""}`);
    }

    const result = parseThemeResponse(received);
    const { css, warnings } = sanitizeCss(stripTokenDeclarations(result.css));
    if (!css.trim()) throw new Error(warnings.at(-1) ?? "The model returned no CSS.");
    const tokens = result.tokens ?? currentTokens;
    editor.finishStreaming(tokens ? withTokenBlock(css, tokens) : css);
    lastPrompt = options.review ? lastPrompt : instructions;
    if (!nameInput.value.trim()) nameInput.value = result.tokens?.name ?? instructions.slice(0, 60);

    const turn: ConversationTurn = { instruction: options.review ? "Review and fix the theme" : instructions, summary: result.summary, at: Date.now() };
    conversation = refine ? [...conversation, turn] : [turn];
    renderConversation();
    afterContentReplaced();
    if (!options.review) promptInput.value = "";

    const notes = [
      !result.tokens && "The model didn't return a palette, so the Palette panel can't edit this result.",
      warnings.length && `Safety fixes: ${warnings.join(" ")}`,
    ].filter(Boolean);
    setProcess(
      `${result.summary || `Generated with ${providerInfo[provider].label}.`} Review the preview, then Save (or Undo).${describeUsage(usage)}${notes.length ? ` ${notes.join(" ")}` : ""}`,
      warnings.length > 0,
    );
  } catch (error) {
    const aborted = generation?.signal.aborted;
    const partial = aborted && received ? sanitizeCss(stripTokenDeclarations(parseThemeResponse(received).css)).css : "";
    if (partial.trim()) {
      editor.finishStreaming(partial);
      afterContentReplaced();
      setProcess("Stopped. The partial result is in the editor (not saved). Undo restores the previous CSS.");
    } else {
      if (snapshotTaken) undoStack.pop();
      editor.finishStreaming(null);
      afterContentReplaced();
      const hint = wantScreenshot && !aborted ? " If this model can't read images, turn off “Send screenshot”." : "";
      setProcess(aborted ? "Stopped." : `Generation failed: ${errorMessage(error)}${hint}`, !aborted);
    }
  } finally {
    generation = null;
    setGenerating(false);
    renderUndo();
    scheduleEstimate();
  }
}

// ----------------------------------------------------------------- wiring

saveButton.addEventListener("click", saveStyle);
newStyleButton.addEventListener("click", startNewStyle);
deleteButton.addEventListener("click", removeStyle);
generateButton.addEventListener("click", () => startGeneration());
reviewButton.addEventListener("click", () => startGeneration({ review: true }));
undoGenerationButton.addEventListener("click", undoGeneration);
aiSettingsButton.addEventListener("click", () => browser.runtime.openOptionsPage());
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    startGeneration();
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
  if (area === "local" && "ai" in changes) void loadAiSettings();
});

window.addEventListener("pagehide", () => previewPort?.disconnect());

void loadAiSettings();
loadStyle().then(() => {
  schedulePreview(0);
  void fetchDigest().then(scheduleEstimate);
});
void tabReady.then((ready) => {
  if (hasTab && !ready) {
    siteName.textContent = `For ${hostname} · preview unavailable (reload the site tab or allow site access)`;
  }
});
