import { describe, expect, it } from "vitest";
import { blend, contrastRatio, parseColor, requiredRatio } from "@/lib/contrast";
import {
  defaultTokens,
  normalizeTokens,
  stripTokenBlock,
  stripTokenDeclarations,
  tokensFromCss,
  tokensToCss,
  withTokenBlock,
} from "@/lib/tokens";

describe("normalizeTokens", () => {
  it("fills missing values from the scheme's defaults", () => {
    const tokens = normalizeTokens({ scheme: "light", colors: { accent: "#123456" } });
    expect(tokens.scheme).toBe("light");
    expect(tokens.colors.accent).toBe("#123456");
    expect(tokens.colors.background).toBe(defaultTokens("light").colors.background);
  });

  it("accepts modern color syntaxes", () => {
    const tokens = normalizeTokens({ colors: { text: "oklch(0.9 0.02 250)", link: "rgb(10 20 30 / 50%)", border: "hsl(210, 10%, 30%)" } });
    expect(tokens.colors.text).toBe("oklch(0.9 0.02 250)");
    expect(tokens.colors.link).toBe("rgb(10 20 30 / 50%)");
    expect(tokens.colors.border).toBe("hsl(210, 10%, 30%)");
  });

  it("rejects values that could break out of the declaration or load resources", () => {
    const tokens = normalizeTokens({
      name: "Evil */ body{display:none} /*",
      colors: { text: "red; } body { display: none", background: "url(https://evil.test/x)" },
      font: { body: 'Inter"; } a { b: c', size: "16px; color: red" },
      shape: { radius: "expression(1)" },
    });
    const css = tokensToCss(tokens);
    // The name lives in a comment; it must not be able to end that comment early.
    const header = css.split("\n")[0] ?? "";
    expect(header.indexOf("*/")).toBe(header.length - 2);
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("display");
    expect(css).not.toContain("evil.test");
    expect(css).not.toContain("expression");
    expect(tokens.name).not.toContain("*/");
    expect(tokens.colors.text).toBe(defaultTokens("dark").colors.text);
  });

  it("treats garbage input as defaults", () => {
    expect(normalizeTokens(null)).toEqual(defaultTokens("dark"));
    expect(normalizeTokens("nope")).toEqual(defaultTokens("dark"));
  });
});

describe("token block", () => {
  const tokens = normalizeTokens({ name: "Ember", scheme: "dark", colors: { accent: "#ff8800" }, font: { body: '"Segoe UI", sans-serif' } });

  it("round-trips through CSS", () => {
    expect(tokensFromCss(tokensToCss(tokens))).toEqual(tokens);
  });

  it("is replaced, not duplicated", () => {
    const first = withTokenBlock("body { color: var(--pc-text); }\n", tokens);
    const second = withTokenBlock(first, { ...tokens, colors: { ...tokens.colors, accent: "#00ff00" } });
    expect(second.match(/pagecraft:tokens:start/g)).toHaveLength(1);
    expect(second).toContain("--pc-accent: #00ff00;");
    expect(second).toContain("body { color: var(--pc-text); }");
  });

  it("can be stripped, and is absent from plain CSS", () => {
    expect(stripTokenBlock(withTokenBlock("a{}", tokens))).toBe("a{}");
    expect(tokensFromCss("a{}")).toBeNull();
  });

  it("removes --pc-* declarations the model wrote itself", () => {
    expect(stripTokenDeclarations(":root { --pc-text: red; --site-bg: var(--pc-background); }")).toBe(":root {  --site-bg: var(--pc-background); }");
  });
});

describe("contrast math", () => {
  it("parses computed color formats", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual([255, 0, 0, 1]);
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(parseColor("rgb(0 0 0 / 50%)")).toEqual([0, 0, 0, 0.5]);
    expect(parseColor("color(srgb 1 1 1)")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("oklch(0.5 0.1 200)")).toBeNull();
  });

  it("computes WCAG ratios", () => {
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
    expect(contrastRatio([119, 119, 119, 1], [255, 255, 255, 1])).toBeCloseTo(4.48, 2);
  });

  it("blends translucent colors over the background", () => {
    expect(blend([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([127.5, 127.5, 127.5, 1]);
  });

  it("uses the large-text threshold", () => {
    expect(requiredRatio(16, 400)).toBe(4.5);
    expect(requiredRatio(24, 400)).toBe(3);
    expect(requiredRatio(19, 700)).toBe(3);
    expect(requiredRatio(19, 400)).toBe(4.5);
  });
});
