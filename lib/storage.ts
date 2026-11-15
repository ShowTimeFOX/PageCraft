import { browser } from "wxt/browser";

export type PresetId = "none" | "dark" | "light";

export interface MyStyle {
  id: string;
  name: string;
  css: string;
  /** Last AI instruction used to generate this style, if any. */
  prompt?: string;
  updatedAt?: number;
}

export interface ThemeSettings {
  enabled: boolean;
  preset: PresetId;
  /** Legacy per-host CSS from 1.0 (kept so old data still applies). */
  styles: Record<string, string>;
  myStyles: MyStyle[];
  /** hostname -> MyStyle id */
  selectedMyStyles: Record<string, string>;
}

export const themeDefaults: ThemeSettings = {
  enabled: true,
  preset: "none",
  styles: {},
  myStyles: [],
  selectedMyStyles: {},
};

export const themeKeys = Object.keys(themeDefaults) as (keyof ThemeSettings)[];

export async function getThemeSettings(): Promise<ThemeSettings> {
  const data = (await browser.storage.local.get(themeDefaults)) as ThemeSettings;
  return {
    enabled: data.enabled !== false,
    preset: (["none", "dark", "light"] as const).includes(data.preset) ? data.preset : "none",
    styles: data.styles ?? {},
    myStyles: Array.isArray(data.myStyles)
      ? data.myStyles.filter((s) => s && typeof s.id === "string" && typeof s.name === "string")
      : [],
    selectedMyStyles: data.selectedMyStyles ?? {},
  };
}

export async function setThemeSettings(patch: Partial<ThemeSettings>): Promise<void> {
  await browser.storage.local.set(patch);
}

// ---------------------------------------------------------------- AI settings

export type ProviderId = "anthropic" | "openai" | "gemini" | "local";

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AiSettings {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
}

export const aiDefaults: AiSettings = {
  activeProvider: "anthropic",
  providers: {
    anthropic: { apiKey: "", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5" },
    openai: { apiKey: "", baseUrl: "https://api.openai.com/v1", model: "" },
    gemini: { apiKey: "", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "" },
    // Ollama's OpenAI-compatible endpoint. LM Studio uses http://localhost:1234/v1.
    local: { apiKey: "", baseUrl: "http://localhost:11434/v1", model: "" },
  },
};

/** API keys live in storage.local only, never storage.sync. */
export async function getAiSettings(): Promise<AiSettings> {
  const { ai } = (await browser.storage.local.get({ ai: null })) as { ai: Partial<AiSettings> | null };
  const providers = { ...aiDefaults.providers };
  for (const id of Object.keys(providers) as ProviderId[]) {
    providers[id] = { ...providers[id], ...(ai?.providers?.[id] ?? {}) };
  }
  const active = ai?.activeProvider && ai.activeProvider in providers ? ai.activeProvider : aiDefaults.activeProvider;
  return { activeProvider: active, providers };
}

export async function setAiSettings(ai: AiSettings): Promise<void> {
  await browser.storage.local.set({ ai });
}
