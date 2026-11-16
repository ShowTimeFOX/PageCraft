import { listModels, providerInfo, streamText, validateConfig } from "@/lib/ai/providers";
import { t } from "@/lib/i18n";
import { requestProviderAccess } from "@/lib/permissions";
import { getStoredAiSettings, setAiSettings, type AiSettings, type DigestSize, type ProviderId } from "@/lib/storage";
import { unlockedKeys, updateVault } from "@/lib/vault";
import { $, errorMessage, setStatus } from "./ui";

const form = $<HTMLFormElement>("settings-form");
const providerSelect = $<HTMLSelectElement>("provider-select");
const providerHelp = $<HTMLParagraphElement>("provider-help");
const keyOptional = $<HTMLSpanElement>("key-optional");
const apiKeyInput = $<HTMLInputElement>("api-key");
const keyLockedNote = $<HTMLParagraphElement>("key-locked-note");
const toggleKey = $<HTMLButtonElement>("toggle-key");
const baseUrlInput = $<HTMLInputElement>("base-url");
const modelInput = $<HTMLInputElement>("model");
const modelList = $<HTMLDataListElement>("model-list");
const loadModelsButton = $<HTMLButtonElement>("load-models");
const inputPriceInput = $<HTMLInputElement>("input-price");
const outputPriceInput = $<HTMLInputElement>("output-price");
const digestSelect = $<HTMLSelectElement>("digest-size");
const testButton = $<HTMLButtonElement>("test-button");
const status = $<HTMLParagraphElement>("status");

let settings: AiSettings;
/** True when keys are vault-protected and the vault is locked: keys are unknown here. */
let keysLocked = false;

const current = () => providerSelect.value as ProviderId;

const parsePrice = (input: HTMLInputElement): number | undefined => {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

/** Copy form fields into the in-memory settings for the selected provider. */
function readForm() {
  const previous = settings.providers[current()];
  settings.providers[current()] = {
    apiKey: keysLocked ? previous.apiKey : apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim(),
    inputPrice: parsePrice(inputPriceInput),
    outputPrice: parsePrice(outputPriceInput),
  };
  settings.activeProvider = current();
  settings.digestSize = digestSelect.value as DigestSize;
}

function renderProvider() {
  const id = current();
  const config = settings.providers[id];
  providerHelp.textContent = providerInfo[id].keyHelp;
  keyOptional.hidden = providerInfo[id].needsKey;
  apiKeyInput.value = keysLocked ? "" : config.apiKey;
  apiKeyInput.disabled = keysLocked;
  apiKeyInput.placeholder = keysLocked ? "••••••••" : "";
  toggleKey.disabled = keysLocked;
  keyLockedNote.hidden = !keysLocked;
  baseUrlInput.value = config.baseUrl;
  modelInput.value = config.model;
  inputPriceInput.value = config.inputPrice?.toString() ?? "";
  outputPriceInput.value = config.outputPrice?.toString() ?? "";
  modelList.replaceChildren();
  setStatus(status, "");
}

/** Ask for access to the provider host. Must run synchronously inside the click handler. */
function askForAccess(): Promise<void> {
  readForm();
  const { baseUrl } = settings.providers[current()];
  return requestProviderAccess(baseUrl).then((granted) => {
    if (!granted) throw new Error(t("optionsNeedsProviderAccess", baseUrl));
  });
}

async function withBusy(target: HTMLButtonElement, task: () => Promise<void>) {
  target.disabled = true;
  try {
    await task();
  } catch (error) {
    setStatus(status, errorMessage(error), true);
  } finally {
    target.disabled = false;
  }
}

/** Store settings, encrypting keys into the vault when protection is on. */
async function persist() {
  const toStore: AiSettings = structuredClone(settings);
  if (toStore.vault) {
    if (!keysLocked) {
      const keys = Object.fromEntries(Object.entries(toStore.providers).map(([id, config]) => [id, config.apiKey]));
      toStore.vault = await updateVault(toStore.vault, keys);
    }
    for (const config of Object.values(toStore.providers)) config.apiKey = "";
  }
  await setAiSettings(toStore);
  settings.vault = toStore.vault;
}

export async function loadAiSection() {
  settings = await getStoredAiSettings();
  keysLocked = false;
  if (settings.vault) {
    const keys = await unlockedKeys(settings.vault);
    keysLocked = keys === null;
    for (const id of Object.keys(settings.providers) as ProviderId[]) settings.providers[id].apiKey = keys?.[id] ?? "";
  }
  if (!providerSelect.options.length) {
    for (const info of Object.values(providerInfo)) providerSelect.add(new Option(info.label, info.id));
  }
  providerSelect.value = settings.activeProvider;
  digestSelect.value = settings.digestSize;
  renderProvider();
}

/** Current keys (empty when locked), for the vault section. */
export function currentKeys(): Record<string, string> {
  return Object.fromEntries(Object.entries(settings.providers).map(([id, config]) => [id, config.apiKey]));
}

export function initAiSection() {
  providerSelect.addEventListener("change", renderProvider);

  // Keep in-memory settings in sync as the user types, so switching providers never loses edits.
  for (const input of [apiKeyInput, baseUrlInput, modelInput, inputPriceInput, outputPriceInput]) {
    input.addEventListener("input", readForm);
  }

  toggleKey.addEventListener("click", () => {
    const show = apiKeyInput.type === "password";
    apiKeyInput.type = show ? "text" : "password";
    toggleKey.textContent = show ? t("optionsHide") : t("optionsShow");
  });

  loadModelsButton.addEventListener("click", () => {
    const access = askForAccess();
    return withBusy(loadModelsButton, async () => {
      await access;
      if (keysLocked && providerInfo[current()].needsKey) throw new Error(t("optionsUnlockFirst"));
      setStatus(status, t("optionsLoadingModels"));
      const models = await listModels(current(), settings.providers[current()]);
      modelList.replaceChildren(...models.map((m) => new Option(m, m)));
      setStatus(status, models.length ? t("optionsModelsFound", models.length) : t("optionsNoModels"));
      if (!modelInput.value && models.length) modelInput.focus();
    });
  });

  testButton.addEventListener("click", () => {
    const access = askForAccess();
    return withBusy(testButton, async () => {
      await access;
      if (keysLocked && providerInfo[current()].needsKey) throw new Error(t("optionsUnlockFirst"));
      const config = settings.providers[current()];
      const problem = validateConfig(current(), config);
      if (problem) throw new Error(problem);
      setStatus(status, t("optionsTesting"));
      let reply = "";
      const stream = streamText(current(), config, {
        system: "Reply with exactly: OK",
        messages: [{ role: "user", content: "Connection test" }],
        maxTokens: 20,
        signal: AbortSignal.timeout(30_000),
      });
      for await (const chunk of stream) reply += chunk;
      setStatus(status, t("optionsConnected", providerInfo[current()].label, reply.trim().slice(0, 80) || "(empty)"));
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const access = askForAccess().catch((error: unknown) => error);
    try {
      await persist();
      const accessError = await access;
      if (accessError) {
        setStatus(status, t("optionsSavedNoAccess", errorMessage(accessError)), true);
        return;
      }
      setStatus(status, t("optionsSaved", providerInfo[current()].label));
    } catch (error) {
      setStatus(status, t("optionsSaveFailed", errorMessage(error)), true);
    }
  });
}
