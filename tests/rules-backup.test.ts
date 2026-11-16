import { describe, expect, it } from "vitest";
import { createBackup, mergeBackup, parseBackup } from "@/lib/backup";
import { findRule, matchesPattern, normalizePattern, rulesFromLegacy, setHostRule, type SiteRule } from "@/lib/rules";
import type { MyStyle } from "@/lib/storage";

let n = 0;
const id = () => `id-${++n}`;
const rule = (pattern: string, styleId: string, enabled = true): SiteRule => ({ id: id(), styleId, pattern, enabled });

describe("site patterns", () => {
  it("normalises and validates", () => {
    expect(normalizePattern("https://Example.com/")).toBe("example.com");
    expect(normalizePattern("*.example.com")).toBe("*.example.com");
    expect(normalizePattern("example.com/docs/*")).toBe("example.com/docs/*");
    expect(normalizePattern("example.com:8080")).toBe("example.com");
    expect(normalizePattern("*")).toBe("*");
    expect(normalizePattern("exa mple.com")).toBeNull();
    expect(normalizePattern("ex*ample.com")).toBeNull();
    expect(normalizePattern("")).toBeNull();
  });

  it("matches hosts, subdomains and paths", () => {
    expect(matchesPattern("example.com", "example.com")).toBe(true);
    expect(matchesPattern("example.com", "www.example.com")).toBe(false);
    expect(matchesPattern("*.example.com", "www.example.com")).toBe(true);
    expect(matchesPattern("*.example.com", "example.com")).toBe(true);
    expect(matchesPattern("*.example.com", "badexample.com")).toBe(false);
    expect(matchesPattern("example.com/docs/*", "example.com", "/docs/intro")).toBe(true);
    expect(matchesPattern("example.com/docs/*", "example.com", "/blog")).toBe(false);
    expect(matchesPattern("*", "anything.test", "/x")).toBe(true);
  });

  it("picks the most specific enabled rule", () => {
    const rules = [rule("*", "global"), rule("*.example.com", "wild"), rule("example.com", "exact"), rule("example.com/docs/*", "docs"), rule("www.example.com", "off", false)];
    expect(findRule(rules, "other.test")?.styleId).toBe("global");
    expect(findRule(rules, "www.example.com")?.styleId).toBe("wild");
    expect(findRule(rules, "example.com", "/")?.styleId).toBe("exact");
    expect(findRule(rules, "example.com", "/docs/a")?.styleId).toBe("docs");
  });

  it("sets and clears the exact-host rule without touching others", () => {
    const start = [rule("*", "global"), rule("example.com", "old")];
    const set = setHostRule(start, "Example.com", "new", id);
    expect(set.filter((r) => r.pattern === "example.com").map((r) => r.styleId)).toEqual(["new"]);
    expect(set.some((r) => r.pattern === "*")).toBe(true);
    expect(setHostRule(set, "example.com", "", id).map((r) => r.pattern)).toEqual(["*"]);
  });

  it("migrates the 1.x hostname map", () => {
    const rules = rulesFromLegacy({ "example.com": "a", "bad host": "b", "x.test": "" }, id);
    expect(rules.map((r) => [r.pattern, r.styleId])).toEqual([["example.com", "a"]]);
  });
});

describe("backups", () => {
  const styles: MyStyle[] = [
    { id: "s1", name: "Dark", css: "body { color: red; }", history: [{ css: "old", savedAt: 1 }], conversation: [{ instruction: "secret", summary: "", at: 1 }] },
    { id: "s2", name: "Light", css: "body { color: blue; }" },
  ];
  const rules = [rule("example.com", "s1"), rule("*", "s2"), rule("gone.test", "missing")];

  it("exports styles and their rules, never history or conversation", () => {
    const backup = createBackup(styles, rules, new Date("2026-01-01T00:00:00Z"));
    expect(backup.format).toBe("pagecraft-themes");
    expect(backup.exportedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(JSON.stringify(backup)).not.toContain("secret");
    expect(JSON.stringify(backup)).not.toContain('"history"');
    expect(backup.rules.map((r) => r.pattern)).toEqual(["example.com", "*"]);
  });

  it("round-trips through parse", () => {
    const parsed = parseBackup(JSON.stringify(createBackup(styles, rules)));
    expect(parsed.styles.map((s) => s.name)).toEqual(["Dark", "Light"]);
    expect(parsed.rules).toHaveLength(2);
    expect(parsed.warnings).toEqual([]);
  });

  it("sanitizes imported CSS", () => {
    const file = JSON.stringify({
      format: "pagecraft-themes",
      version: 1,
      styles: [{ id: "x", name: "Evil", css: "input[value^=a]{background:url(https://evil.test/a)} body{color:red}" }],
      rules: [{ pattern: "*", styleId: "x" }, { pattern: "not a pattern", styleId: "x" }],
    });
    const parsed = parseBackup(file);
    expect(parsed.styles[0]?.css).not.toContain("evil.test");
    expect(parsed.styles[0]?.css).toContain("color:red");
    expect(parsed.warnings.join(" ")).toContain("Evil");
    expect(parsed.rules.map((r) => r.pattern)).toEqual(["*"]);
  });

  it("rejects files that aren't exports", () => {
    expect(() => parseBackup("nope")).toThrow(/valid JSON/);
    expect(() => parseBackup('{"styles":[]}')).toThrow(/theme export/);
    expect(() => parseBackup('{"format":"pagecraft-themes","version":9,"styles":[]}')).toThrow(/version/);
  });

  it("merges: same id+name updates, clashing id gets a new id, rules replace by pattern", () => {
    const current = { styles: [{ id: "s1", name: "Dark", css: "a{}" }, { id: "s2", name: "Mine", css: "b{}" }], rules: [rule("example.com", "s2")] };
    const imported = parseBackup(JSON.stringify(createBackup(styles, rules)));
    const result = mergeBackup(current, imported, id);
    expect(result.updated).toBe(1);
    expect(result.added).toBe(1);
    expect(result.styles.find((s) => s.id === "s1")?.css).toBe("body { color: red; }");
    const light = result.styles.find((s) => s.name === "Light");
    expect(light?.id).not.toBe("s2"); // "s2" belongs to "Mine" here
    expect(result.rules.filter((r) => r.pattern === "example.com").map((r) => r.styleId)).toEqual(["s1"]);
    expect(result.rules.find((r) => r.pattern === "*")?.styleId).toBe(light?.id);
  });
});
