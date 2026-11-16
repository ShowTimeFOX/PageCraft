import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateCost, estimateImageTokens, estimateInputTokens, formatCost, formatTokens } from "@/lib/ai/estimate";
import { t } from "@/lib/i18n";
import catalog from "@/public/_locales/en/messages.json";

describe("estimates", () => {
  it("counts text and images per provider", () => {
    const messages = [{ role: "user" as const, content: [{ type: "image" as const, mediaType: "image/jpeg" as const, data: "" }, { type: "text" as const, text: "x".repeat(360) }] }];
    const anthropic = estimateInputTokens("anthropic", "", messages, [{ width: 1280, height: 720 }]);
    expect(anthropic).toBe(4 + 100 + Math.ceil((1280 * 720) / 750));
    expect(estimateImageTokens("openai", { width: 1280, height: 720 })).toBe(85 + 170 * 6);
    expect(estimateImageTokens("gemini", { width: 300, height: 300 })).toBe(258);
    expect(estimateImageTokens("gemini", { width: 1280, height: 720 })).toBe(516);
  });

  it("only prices when the user entered prices", () => {
    const base = { apiKey: "", baseUrl: "", model: "" };
    expect(estimateCost(base, 1_000_000, 1_000_000)).toBeNull();
    expect(estimateCost({ ...base, inputPrice: 3, outputPrice: 15 }, 1_000_000, 100_000)).toBeCloseTo(4.5);
  });

  it("formats", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(6_240)).toBe("6.2k");
    expect(formatTokens(42_000)).toBe("42k");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(0.0421)).toBe("$0.042");
    expect(formatCost(4.5)).toBe("$4.50");
  });
});

/** Every file under a folder, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("i18n catalog", () => {
  const keys = new Set(Object.keys(catalog));

  it("has every key referenced from HTML and TypeScript", () => {
    const missing: string[] = [];
    for (const file of [...files("entrypoints"), ...files("lib")]) {
      if (!/\.(ts|html)$/.test(file) || file.endsWith("i18n.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\("([A-Za-z]+)"|data-i18n(?:-[a-z-]+)?="([A-Za-z]+)"/g)) {
        const key = match[1] ?? match[2]!;
        if (!keys.has(key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has the manifest's keys and no raw $ (the i18n API treats $ as a placeholder)", () => {
    for (const key of ["extName", "extDescription", "extActionTitle"]) expect(keys.has(key)).toBe(true);
    for (const [key, entry] of Object.entries(catalog)) expect(entry.message, key).not.toContain("$");
  });

  it("substitutes arguments", () => {
    expect(t("optionsModelsFound", 3)).toBe("Found 3 models. Pick one in the Model field.");
    expect(t("popupRuleNote", "Dark", "*.example.com")).toBe("“Dark” applies here through the rule *.example.com.");
  });
});
