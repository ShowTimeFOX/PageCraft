import type { ProviderConfig, ProviderId } from "../storage";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png"; data: string /* base64, no data: prefix */ };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ContentPart[];
}

const partsOf = (content: ChatMessage["content"]): ContentPart[] =>
  typeof content === "string" ? [{ type: "text", text: content }] : content;

/** Anthropic Messages format. */
function toAnthropic(message: ChatMessage) {
  if (typeof message.content === "string") return message;
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.data } },
    ),
  };
}

/** OpenAI Chat Completions format (also Ollama / LM Studio vision models). */
function toOpenAi(message: ChatMessage) {
  if (typeof message.content === "string") return message;
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.data}` } },
    ),
  };
}

/** Gemini generateContent format. */
function toGemini(message: ChatMessage) {
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: partsOf(message.content).map((part) =>
      part.type === "text" ? { text: part.text } : { inlineData: { mimeType: part.mediaType, data: part.data } },
    ),
  };
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerateRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** Called with token counts as the provider reports them (cumulative, may be partial). */
  onUsage?: (usage: Usage) => void;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  needsKey: boolean;
  keyHelp: string;
}

export const providerInfo: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    needsKey: true,
    keyHelp: "Create a key at console.anthropic.com.",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    needsKey: true,
    keyHelp: "Create a key at platform.openai.com. Any OpenAI-compatible service (OpenRouter, Groq, …) works with a custom base URL.",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    keyHelp: "Create a key at aistudio.google.com.",
  },
  local: {
    id: "local",
    label: "Local (Ollama, LM Studio, llama.cpp)",
    needsKey: false,
    keyHelp: "Any OpenAI-compatible local server. Ollama needs OLLAMA_ORIGINS=chrome-extension://*,moz-extension://* to accept extension requests.",
  },
};

export class ProviderError extends Error {}

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function ensureOk(response: Response, provider: ProviderId): Promise<void> {
  if (response.ok) return;
  let detail = "";
  try {
    const body = await response.text();
    try {
      const json = JSON.parse(body);
      detail = json?.error?.message ?? json?.message ?? body;
    } catch {
      detail = body;
    }
  } catch {
    // ignore
  }
  let hint = "";
  if (provider === "local" && response.status === 403) {
    hint = " The local server rejected the extension origin. For Ollama, set OLLAMA_ORIGINS=chrome-extension://*,moz-extension://* and restart it.";
  } else if (response.status === 401 || response.status === 403) {
    hint = " Check the API key in PageCraft settings.";
  }
  throw new ProviderError(`${providerInfo[provider].label} returned ${response.status}: ${detail.slice(0, 300)}${hint}`);
}

/** Parse a Server-Sent Events body into the JSON payloads of its `data:` lines. */
async function* readSse(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new ProviderError("The response had no body to stream.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  if (buffer.startsWith("data:")) yield buffer.slice(5).trim();
}

function parseJson(data: string): any {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------ Anthropic

function anthropicHeaders(config: ProviderConfig): HeadersInit {
  return {
    "content-type": "application/json",
    "x-api-key": config.apiKey,
    "anthropic-version": "2023-06-01",
    // Required because requests from an extension carry a browser Origin header.
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

async function* streamAnthropic(config: ProviderConfig, req: GenerateRequest): AsyncGenerator<string> {
  const response = await fetch(`${trimBase(config.baseUrl)}/messages`, {
    method: "POST",
    headers: anthropicHeaders(config),
    body: JSON.stringify({
      model: config.model,
      max_tokens: req.maxTokens ?? 8000,
      system: req.system,
      messages: req.messages.map(toAnthropic),
      stream: true,
    }),
    signal: req.signal,
  });
  await ensureOk(response, "anthropic");
  const usage: Usage = {};
  for await (const data of readSse(response)) {
    const event = parseJson(data);
    if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
      yield event.delta.text;
    } else if (event?.type === "message_start" && event.message?.usage) {
      const u = event.message.usage;
      usage.inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      req.onUsage?.({ ...usage });
    } else if (event?.type === "message_delta" && event.usage?.output_tokens !== undefined) {
      usage.outputTokens = event.usage.output_tokens;
      req.onUsage?.({ ...usage });
    } else if (event?.type === "error") {
      throw new ProviderError(event.error?.message ?? "Anthropic stream error.");
    }
  }
}

// ---------------------------------------------------------- OpenAI-compatible

async function* streamOpenAiCompatible(
  provider: ProviderId,
  config: ProviderConfig,
  req: GenerateRequest,
): AsyncGenerator<string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(`${trimBase(config.baseUrl)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "system", content: req.system }, ...req.messages.map(toOpenAi)],
      stream: true,
      // OpenAI reports usage in a final chunk when asked. Not sent to local servers,
      // some of which reject unknown fields.
      ...(provider === "openai" && { stream_options: { include_usage: true } }),
    }),
    signal: req.signal,
  });
  await ensureOk(response, provider);
  for await (const data of readSse(response)) {
    if (data === "[DONE]") return;
    const chunk = parseJson(data);
    if (chunk?.error) throw new ProviderError(chunk.error.message ?? "Stream error.");
    if (chunk?.usage) req.onUsage?.({ inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens });
    const text = chunk?.choices?.[0]?.delta?.content;
    if (typeof text === "string" && text) yield text;
  }
}

// --------------------------------------------------------------------- Gemini

async function* streamGemini(config: ProviderConfig, req: GenerateRequest): AsyncGenerator<string> {
  const model = config.model.replace(/^models\//, "");
  const response = await fetch(
    `${trimBase(config.baseUrl)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.messages.map(toGemini),
        generationConfig: { maxOutputTokens: req.maxTokens ?? 8000 },
      }),
      signal: req.signal,
    },
  );
  await ensureOk(response, "gemini");
  for await (const data of readSse(response)) {
    const chunk = parseJson(data);
    if (chunk?.error) throw new ProviderError(chunk.error.message ?? "Gemini stream error.");
    if (chunk?.usageMetadata) {
      req.onUsage?.({ inputTokens: chunk.usageMetadata.promptTokenCount, outputTokens: chunk.usageMetadata.candidatesTokenCount });
    }
    for (const part of chunk?.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part?.text === "string" && !part.thought) yield part.text;
    }
  }
}

// ---------------------------------------------------------------- public API

export function validateConfig(provider: ProviderId, config: ProviderConfig): string | null {
  if (!config.baseUrl.trim()) return "Set a base URL.";
  if (providerInfo[provider].needsKey && !config.apiKey.trim()) return "Add an API key in PageCraft settings.";
  if (!config.model.trim()) return "Choose a model in PageCraft settings.";
  return null;
}

/** Stream generated text from the given provider. */
export function streamText(
  provider: ProviderId,
  config: ProviderConfig,
  req: GenerateRequest,
): AsyncGenerator<string> {
  const problem = validateConfig(provider, config);
  if (problem) throw new ProviderError(problem);
  switch (provider) {
    case "anthropic":
      return streamAnthropic(config, req);
    case "gemini":
      return streamGemini(config, req);
    case "openai":
    case "local":
      return streamOpenAiCompatible(provider, config, req);
  }
}

/** List model ids the provider offers for text generation. */
export async function listModels(provider: ProviderId, config: ProviderConfig): Promise<string[]> {
  const base = trimBase(config.baseUrl);
  let response: Response;
  if (provider === "anthropic") {
    response = await fetch(`${base}/models?limit=100`, { headers: anthropicHeaders(config) });
  } else if (provider === "gemini") {
    response = await fetch(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": config.apiKey } });
  } else {
    response = await fetch(`${base}/models`, {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
    });
  }
  await ensureOk(response, provider);
  const json = await response.json();
  if (provider === "gemini") {
    return (json.models ?? [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""));
  }
  return (json.data ?? []).map((m: any) => String(m.id)).sort();
}
