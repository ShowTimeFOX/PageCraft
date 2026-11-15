import { listModels, providerInfo, streamText, validateConfig } from "@/lib/ai/providers";
import { getAiSettings, setAiSettings, type AiSettings, type ProviderId } from "@/lib/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>("settings-form");
const providerSelect = $<HTMLSelectElement>("provider-select");
const providerHelp = $<HTMLParagraphElement>("provider-help");
const keyOptional = $<HTMLSpanElement>("key-optional");
const apiKeyInput = $<HTMLInputElement>("api-key");
const toggleKey = $<HTMLButtonElement>("toggle-key");
const baseUrlInput = $<HTMLInputElement>("base-url");
const modelInput = $<HTMLInputElement>("model");
const modelList = $<HTMLDataListElement>("model-list");
const loadModelsButton = $<HTMLButtonElement>("load-models");
const testButton = $<HTMLButtonElement>("test-button");
const status = $<HTMLParagraphElement>("status");

let settings: AiSettings;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function setStatus(message: string, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function current(): ProviderId {
  return providerSelect.value as ProviderId;
}

/** Copy form fields into the in-memory settings for the selected provider. */
function readForm() {
  settings.providers[current()] = {
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim(),
  };
  settings.activeProvider = current();
}

function renderProvider() {
  const id = current();
  const config = settings.providers[id];
  providerHelp.textContent = providerInfo[id].keyHelp;
  keyOptional.hidden = providerInfo[id].needsKey;
  apiKeyInput.value = config.apiKey;
  baseUrlInput.value = config.baseUrl;
  modelInput.value = config.model;
  modelList.replaceChildren();
  setStatus("");
}

async function withBusy(button: HTMLButtonElement, task: () => Promise<void>) {
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    setStatus(errorMessage(error), true);
  } finally {
    button.disabled = false;
  }
}

providerSelect.addEventListener("change", renderProvider);

// Keep in-memory settings in sync as the user types, so switching providers never loses edits.
for (const input of [apiKeyInput, baseUrlInput, modelInput]) {
  input.addEventListener("input", () => {
    settings.providers[current()] = {
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(),
    };
  });
}

toggleKey.addEventListener("click", () => {
  const show = apiKeyInput.type === "password";
  apiKeyInput.type = show ? "text" : "password";
  toggleKey.textContent = show ? "Hide" : "Show";
});

loadModelsButton.addEventListener("click", () =>
  withBusy(loadModelsButton, async () => {
    readForm();
    setStatus("Loading models…");
    const models = await listModels(current(), settings.providers[current()]);
    modelList.replaceChildren(...models.map((m) => new Option(m, m)));
    setStatus(models.length ? `Found ${models.length} models. Pick one in the Model field.` : "The provider returned no models.");
    if (!modelInput.value && models.length) modelInput.focus();
  }),
);

testButton.addEventListener("click", () =>
  withBusy(testButton, async () => {
    readForm();
    const config = settings.providers[current()];
    const problem = validateConfig(current(), config);
    if (problem) throw new Error(problem);
    setStatus("Sending a test request…");
    let reply = "";
    const stream = streamText(current(), config, {
      system: "Reply with exactly: OK",
      messages: [{ role: "user", content: "Connection test" }],
      maxTokens: 20,
      signal: AbortSignal.timeout(30_000),
    });
    for await (const chunk of stream) reply += chunk;
    setStatus(`Connected. ${providerInfo[current()].label} replied: “${reply.trim().slice(0, 80) || "(empty)"}”`);
  }),
);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    readForm();
    await setAiSettings(settings);
    setStatus(`Saved. ${providerInfo[current()].label} is now used for generation.`);
  } catch (error) {
    setStatus(`Could not save: ${errorMessage(error)}`, true);
  }
});

async function init() {
  settings = await getAiSettings();
  for (const info of Object.values(providerInfo)) providerSelect.add(new Option(info.label, info.id));
  providerSelect.value = settings.activeProvider;
  renderProvider();
}

init().catch((error) => setStatus(`Could not load settings: ${errorMessage(error)}`, true));
