import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, ProviderError, streamText, validateConfig } from "@/lib/ai/providers";
import type { ProviderConfig } from "@/lib/storage";

/** A streaming Response whose body arrives in the given chunks (split mid-line on purpose). */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" }, ...init });
}

function splitEvery(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}

const config = (patch: Partial<ProviderConfig> = {}): ProviderConfig => ({
  apiKey: "test-key",
  baseUrl: "https://api.example.test/v1/",
  model: "test-model",
  ...patch,
});

const request = { system: "sys", messages: [{ role: "user" as const, content: "hi" }] };

afterEach(() => vi.unstubAllGlobals());

describe("validateConfig", () => {
  it("requires a key for cloud providers but not for local", () => {
    expect(validateConfig("anthropic", config({ apiKey: "" }))).toMatch(/API key/);
    expect(validateConfig("local", config({ apiKey: "" }))).toBeNull();
  });

  it("requires a model", () => {
    expect(validateConfig("openai", config({ model: " " }))).toMatch(/model/);
  });

  it("makes streamText throw before any request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(() => streamText("gemini", config({ apiKey: "" }), request)).toThrow(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Anthropic", () => {
  it("sends the browser-access header and parses text deltas", async () => {
    const events = [
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"body "}}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{}"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");
    const fetchMock = vi.fn(async () => sseResponse(splitEvery(events, 7)));
    vi.stubGlobal("fetch", fetchMock);

    expect(await collect(streamText("anthropic", config(), request))).toBe("body {}");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["x-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "test-model", system: "sys", stream: true });
  });

  it("surfaces stream error events", async () => {
    vi.stubGlobal("fetch", async () =>
      sseResponse(['event: error\ndata: {"type":"error","error":{"message":"Overloaded"}}\n\n']),
    );
    await expect(collect(streamText("anthropic", config(), request))).rejects.toThrow("Overloaded");
  });
});

describe("OpenAI-compatible", () => {
  it("parses deltas, handles CRLF, and stops at [DONE]", async () => {
    const events =
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"a{"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"}"}}]}\r\n\r\n' +
      "data: [DONE]\r\n\r\n" +
      'data: {"choices":[{"delta":{"content":"IGNORED"}}]}\r\n\r\n';
    const fetchMock = vi.fn(async () => sseResponse(splitEvery(events, 5)));
    vi.stubGlobal("fetch", fetchMock);

    expect(await collect(streamText("openai", config(), request))).toBe("a{}");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v1/chat/completions");
    expect(JSON.parse(init.body as string).messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("omits the Authorization header for local servers without a key", async () => {
    const fetchMock = vi.fn(async () => sseResponse(["data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamText("local", config({ apiKey: "" }), request));
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("explains Ollama's origin check on 403", async () => {
    vi.stubGlobal("fetch", async () => new Response("forbidden", { status: 403 }));
    await expect(collect(streamText("local", config({ apiKey: "" }), request))).rejects.toThrow(/OLLAMA_ORIGINS/);
  });

  it("shows the provider's error message and a key hint on 401", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 }),
    );
    await expect(collect(streamText("openai", config(), request))).rejects.toThrow(/Incorrect API key.*Check the API key/);
  });
});

describe("Gemini", () => {
  it("maps roles, puts the key in a header and skips thought parts", async () => {
    const events =
      'data: {"candidates":[{"content":{"parts":[{"text":"thinking…","thought":true}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"a{"},{"text":"}"}]}}]}\n\n';
    const fetchMock = vi.fn(async () => sseResponse(splitEvery(events, 9)));
    vi.stubGlobal("fetch", fetchMock);

    const out = await collect(
      streamText("gemini", config({ model: "models/gem-x" }), {
        system: "sys",
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
        ],
      }),
    );
    expect(out).toBe("a{}");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v1/models/gem-x:streamGenerateContent?alt=sse");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model"]);
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });
});

describe("listModels", () => {
  it("keeps only Gemini models that support generateContent", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        models: [
          { name: "models/gem-chat", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gem-embed", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    );
    expect(await listModels("gemini", config())).toEqual(["gem-chat"]);
  });

  it("returns sorted ids for OpenAI-compatible servers", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ data: [{ id: "b" }, { id: "a" }] }));
    expect(await listModels("local", config({ apiKey: "" }))).toEqual(["a", "b"]);
  });
});

describe("image parts", () => {
  const withImage = {
    system: "sys",
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "image" as const, mediaType: "image/jpeg" as const, data: "QUJD" },
          { type: "text" as const, text: "look" },
        ],
      },
    ],
  };

  const bodyOf = async (provider: "anthropic" | "openai" | "gemini") => {
    const fetchMock = vi.fn(async () => sseResponse(["data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamText(provider, config(), withImage));
    return JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  };

  it("uses Anthropic base64 image blocks", async () => {
    const body = await bodyOf("anthropic");
    expect(body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
    expect(body.messages[0].content[1]).toEqual({ type: "text", text: "look" });
  });

  it("uses OpenAI image_url data URLs", async () => {
    const body = await bodyOf("openai");
    expect(body.messages[1].content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
  });

  it("uses Gemini inlineData parts", async () => {
    const body = await bodyOf("gemini");
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
    expect(body.contents[0].parts[1]).toEqual({ text: "look" });
  });
});

describe("usage reporting", () => {
  const run = async (provider: "anthropic" | "openai" | "gemini", events: string) => {
    const fetchMock = vi.fn(async () => sseResponse([events]));
    vi.stubGlobal("fetch", fetchMock);
    const seen: { inputTokens?: number; outputTokens?: number }[] = [];
    await collect(streamText(provider, config(), { ...request, onUsage: (u) => seen.push(u) }));
    return { last: seen.at(-1), body: JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) };
  };

  it("reads Anthropic message_start and message_delta usage", async () => {
    const { last } = await run(
      "anthropic",
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":20}}}\n\n' +
        'data: {"type":"message_delta","usage":{"output_tokens":42}}\n\n',
    );
    expect(last).toEqual({ inputTokens: 120, outputTokens: 42 });
  });

  it("asks OpenAI for usage and reads the final chunk", async () => {
    const { last, body } = await run("openai", 'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(last).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("does not send stream_options to local servers", async () => {
    const fetchMock = vi.fn(async () => sseResponse(["data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamText("local", config({ apiKey: "" }), request));
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).stream_options).toBeUndefined();
  });

  it("reads Gemini usageMetadata", async () => {
    const { last } = await run("gemini", 'data: {"candidates":[],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":5}}\n\n');
    expect(last).toEqual({ inputTokens: 11, outputTokens: 5 });
  });
});
