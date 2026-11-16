/**
 * Rough token and cost estimates. Real counts come from each provider's tokenizer; these are
 * deliberately simple approximations shown with "≈". Prices are never hardcoded: cost is only
 * shown when the user entered their own per-million-token prices in settings.
 */
import type { ProviderConfig, ProviderId } from "../storage";
import type { ChatMessage } from "./providers";

/** Typical size of a generated theme (tokens JSON + CSS + summary). */
export const TYPICAL_OUTPUT_TOKENS = 4_000;

export interface ImageSize {
  width: number;
  height: number;
}

/** About 4 characters per token for English prose; code and JSON are a bit denser. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/** Per-provider image token rules, approximated from their public documentation. */
export function estimateImageTokens(provider: ProviderId, { width, height }: ImageSize): number {
  if (provider === "gemini") {
    if (width <= 384 && height <= 384) return 258;
    return Math.ceil(width / 768) * Math.ceil(height / 768) * 258;
  }
  if (provider === "openai") {
    // Fit within 2048x2048, then shortest side to 768, then 512px tiles.
    let w = width;
    let h = height;
    const fit = Math.min(1, 2048 / Math.max(w, h));
    w *= fit;
    h *= fit;
    const shortest = Math.min(1, 768 / Math.min(w, h));
    w *= shortest;
    h *= shortest;
    return 85 + 170 * Math.ceil(w / 512) * Math.ceil(h / 512);
  }
  // Anthropic (and a reasonable guess for local vision models).
  return Math.min(1_600, Math.ceil((width * height) / 750));
}

export function estimateInputTokens(
  provider: ProviderId,
  system: string,
  messages: ChatMessage[],
  imageSizes: ImageSize[] = [],
): number {
  let tokens = estimateTextTokens(system);
  let imageIndex = 0;
  for (const message of messages) {
    tokens += 4; // per-message overhead
    if (typeof message.content === "string") {
      tokens += estimateTextTokens(message.content);
      continue;
    }
    for (const part of message.content) {
      if (part.type === "text") tokens += estimateTextTokens(part.text);
      else tokens += estimateImageTokens(provider, imageSizes[imageIndex++] ?? { width: 1280, height: 800 });
    }
  }
  return tokens;
}

export function estimateCost(config: ProviderConfig, inputTokens: number, outputTokens: number): number | null {
  if (config.inputPrice === undefined && config.outputPrice === undefined) return null;
  return (inputTokens * (config.inputPrice ?? 0) + outputTokens * (config.outputPrice ?? 0)) / 1_000_000;
}

export function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
}

export function formatCost(cost: number): string {
  return cost < 0.01 ? `<$0.01` : `$${cost.toFixed(cost < 1 ? 3 : 2)}`;
}
