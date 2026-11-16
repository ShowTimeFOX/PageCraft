import { describe, expect, it } from "vitest";
import { parseFences } from "@/lib/ai/fences";
import { buildThemeMessages, MAX_HISTORY_TURNS, parseThemeResponse } from "@/lib/ai/prompt";
import { extractCss } from "@/lib/ai/sanitize";
import { defaultTokens } from "@/lib/tokens";

const digest = {
  url: "https://example.com/",
  title: "Example",
  lang: "en",
  colorScheme: "normal",
  customProperties: ["--bg: #fff"],
  backgrounds: ["rgb(255, 255, 255)"],
  textColors: ["rgb(0, 0, 0)"],
  fonts: ["Arial"],
  outline: "header\nmain",
};

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : (content as { type: string; text?: string }[]).map((p) => p.text ?? "").join("");

describe("parseFences", () => {
  it("separates blocks from prose", () => {
    const parsed = parseFences('```json\n{"a":1}\n```\n\n```css\na{}\n```\nMade it warmer.');
    expect(parsed.blocks.map((b) => [b.lang, b.body, b.closed])).toEqual([
      ["json", '{"a":1}', true],
      ["css", "a{}", true],
    ]);
    expect(parsed.prose).toBe("Made it warmer.");
  });

  it("marks an unterminated block as open", () => {
    expect(parseFences("```css\na{").blocks[0]).toEqual({ lang: "css", body: "a{", closed: false });
  });
});

describe("extractCss with a token block present", () => {
  it("ignores the JSON block", () => {
    expect(extractCss('```json\n{"name":"x"}\n```\n```css\nbody{}\n```')).toBe("body{}\n");
    expect(extractCss('```json\n{"name":"x"}\n```')).toBe("");
  });
});

describe("parseThemeResponse", () => {
  it("reads tokens, css and summary", () => {
    const text = '```json\n{"name":"Ember","scheme":"dark","colors":{"accent":"#ff8800"}}\n```\n```css\nbody { color: var(--pc-text); }\n```\nWarm dark theme with orange accents.';
    const result = parseThemeResponse(text);
    expect(result.tokens?.name).toBe("Ember");
    expect(result.tokens?.colors.accent).toBe("#ff8800");
    expect(result.tokens?.colors.background).toBe(defaultTokens("dark").colors.background);
    expect(result.css).toBe("body { color: var(--pc-text); }\n");
    expect(result.summary).toBe("Warm dark theme with orange accents.");
  });

  it("waits for the JSON block to close before parsing tokens", () => {
    expect(parseThemeResponse('```json\n{"name":"Em').tokens).toBeNull();
  });

  it("survives invalid JSON and CSS-only answers", () => {
    expect(parseThemeResponse("```json\n{nope}\n```\n```css\na{}\n```").tokens).toBeNull();
    expect(parseThemeResponse("```css\na{}\n```").css).toBe("a{}\n");
  });
});

describe("buildThemeMessages", () => {
  it("includes digest, tokens, current CSS and instructions last", () => {
    const messages = buildThemeMessages({
      hostname: "example.com",
      instructions: "make it dark",
      digest,
      currentTokens: defaultTokens("light"),
      currentCss: "body{color:red}",
    });
    expect(messages).toHaveLength(1);
    const text = textOf(messages[0]?.content);
    expect(text).toContain("Website: example.com");
    expect(text).toContain("--bg: #fff");
    expect(text).toContain('"scheme": "light"');
    expect(text).toContain("```css\nbody{color:red}\n```");
    expect(text.trim().endsWith("make it dark")).toBe(true);
  });

  it("works without a digest or current theme", () => {
    const [message] = buildThemeMessages({ hostname: "x.test", instructions: "warm", digest: null, currentCss: "" });
    const text = textOf(message?.content);
    expect(text).toContain("Page digest: unavailable");
    expect(text).not.toContain("Current CSS");
    expect(text).not.toContain("Current tokens");
  });

  it("replays recent turns as alternating user/assistant messages", () => {
    const history = Array.from({ length: 9 }, (_, i) => ({ instruction: `ask ${i}`, summary: i % 2 ? `did ${i}` : "", at: i }));
    const messages = buildThemeMessages({ hostname: "x.test", instructions: "now", history });
    expect(messages).toHaveLength(MAX_HISTORY_TURNS * 2 + 1);
    expect(messages.map((m) => m.role).slice(0, 4)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[0]?.content).toBe(`ask ${9 - MAX_HISTORY_TURNS}`);
    expect(messages[2 * 1 + 1]?.content).toBe("Updated the theme.");
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("attaches the screenshot as an image part and includes the contrast report", () => {
    const [message] = buildThemeMessages({
      hostname: "x.test",
      instructions: "fix",
      screenshot: { mediaType: "image/jpeg", data: "QUJD" },
      contrast: {
        checked: 10,
        failing: 2,
        issues: [{ selector: "p.muted", color: "rgb(120, 120, 120)", background: "rgb(100, 100, 100)", ratio: 1.3, required: 4.5, count: 2 }],
      },
    });
    const parts = message?.content as { type: string; data?: string; text?: string }[];
    expect(parts[0]).toEqual({ type: "image", mediaType: "image/jpeg", data: "QUJD" });
    expect(parts[1]?.text).toContain("p.muted ×2: rgb(120, 120, 120) on rgb(100, 100, 100) = 1.30:1 (needs 4.5:1)");
  });
});
