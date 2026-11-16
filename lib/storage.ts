import { browser } from "wxt/browser";
import { rulesFromLegacy, type SiteRule } from "./rules";
import { unlockedKeys, type Vault } from "./vault";

export type { SiteRule } from "./rules";

export type PresetId = "none" | "dark" | "light";

export interface StyleVersion {
  css: string;
  prompt?: string;
  savedAt: number;
}

/** One refinement step: what the user asked and the model's one-line summary. */
export interface ConversationTurn {
  instruction: string;
  summary: string;
  at: number;
}

export interface MyStyle {
  id: string;
  name: string;
  css: string;
  /** Last AI instruction used to generate this style, if any. */
  prompt?: string;
  updatedAt?: number;
  /** Previously saved versions, newest first. */
  history?: StyleVersion[];
  /** Instructions and model summaries that produced this style, oldest first. */
  conversation?: ConversationTurn[];
}

export interface InjectionSettings {
  /** Apply themes inside iframes too (each frame uses its own hostname's style). */
  frames: boolean;
  /** Copy the theme into open shadow roots (web components). Can affect component styling. */
  shadowRoots: boolean;
}

/** Per-site overrides (keyed by hostname). Unset fields use the global setting. */
export interface SiteOverride {
  paused?: boolean;
  frames?: boolean;
  shadowRoots?: boolean;
}

export interface ThemeSettings {
  enabled: boolean;
  preset: PresetId;
  /** Legacy per-host CSS from 1.0 (kept so old data still applies). */
  styles: Record<string, string>;
  myStyles: MyStyle[];
  /** Legacy 1.x map (hostname -> style id). Read once to build siteRules; no longer written. */
  selectedMyStyles: Record<string, string>;
  /** Which style applies where (host patterns, global themes). */
  siteRules: SiteRule[];
  siteSettings: Record<string, SiteOverride>;
  injection: InjectionSettings;
}

export const themeDefaults: ThemeSettings = {
  enabled: true,
  preset: "none",
  styles: {},
  myStyles: [],
  selectedMyStyles: {},
  siteRules: [],
  siteSettings: {},
  injection: { frames: true, shadowRoots: false },
};

export const themeKeys = Object.keys(themeDefaults) as (keyof ThemeSettings)[];

export async function getThemeSettings(): Promise<ThemeSettings> {
  // siteRules: null marks "never saved", so 1.x data can be migrated from selectedMyStyles.
  const data = (await browser.storage.local.get({ ...themeDefaults, siteRules: null })) as Omit<ThemeSettings, "siteRules"> & {
    siteRules: SiteRule[] | null;
  };
  const siteRules = Array.isArray(data.siteRules)
    ? data.siteRules.filter((r) => r && typeof r.pattern === "string" && typeof r.styleId === "string")
    : rulesFromLegacy(data.selectedMyStyles ?? {}, () => crypto.randomUUID());
  return {
    enabled: data.enabled !== false,
    preset: (["none", "dark", "light"] as const).includes(data.preset) ? data.preset : "none",
    styles: data.styles ?? {},
    myStyles: Array.isArray(data.myStyles)
      ? data.myStyles.filter((s) => s && typeof s.id === "string" && typeof s.name === "string")
      : [],
    selectedMyStyles: data.selectedMyStyles ?? {},
    siteRules,
    siteSettings: data.siteSettings ?? {},
    injection: { ...themeDefaults.injection, ...(data.injection ?? {}) },
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
  /** Optional, user-entered USD prices per million tokens, for cost estimates. */
  inputPrice?: number;
  outputPrice?: number;
}

export type DigestSize = "small" | "normal" | "large";

export interface AiSettings {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  /** How much page structure to send. */
  digestSize: DigestSize;
  /** Passphrase-encrypted API keys. When set, the apiKey fields above are stored empty. */
  vault: Vault | null;
}

export const aiDefaults: AiSettings = {
  activeProvider: "anthropic",
  digestSize: "normal",
  vault: null,
  providers: {
    anthropic: { apiKey: "", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5" },
    openai: { apiKey: "", baseUrl: "https://api.openai.com/v1", model: "" },
    gemini: { apiKey: "", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "" },
    // Ollama's OpenAI-compatible endpoint. LM Studio uses http://localhost:1234/v1.
    local: { apiKey: "", baseUrl: "http://localhost:11434/v1", model: "" },
  },
};

/** The stored settings, without decrypting vaulted keys. */
export async function getStoredAiSettings(): Promise<AiSettings> {
  const { ai } = (await browser.storage.local.get({ ai: null })) as { ai: Partial<AiSettings> | null };
  const providers = { ...aiDefaults.providers };
  for (const id of Object.keys(providers) as ProviderId[]) {
    providers[id] = { ...providers[id], ...(ai?.providers?.[id] ?? {}) };
  }
  const active = ai?.activeProvider && ai.activeProvider in providers ? ai.activeProvider : aiDefaults.activeProvider;
  const digestSize = ai?.digestSize === "small" || ai?.digestSize === "large" ? ai.digestSize : "normal";
  return { activeProvider: active, providers, digestSize, vault: ai?.vault ?? null };
}

/**
 * Settings with usable API keys. API keys live in storage.local only, never storage.sync.
 * With a vault, keys are filled in only while it is unlocked (this browser session).
 */
export async function getAiSettings(): Promise<AiSettings> {
  const settings = await getStoredAiSettings();
  if (settings.vault) {
    const keys = await unlockedKeys(settings.vault);
    for (const id of Object.keys(settings.providers) as ProviderId[]) {
      settings.providers[id].apiKey = keys?.[id] ?? "";
    }
  }
  return settings;
}

/** Store settings. Callers using a vault must blank apiKey fields first (see vault.ts). */
export async function setAiSettings(ai: AiSettings): Promise<void> {
  await browser.storage.local.set({ ai });
}
