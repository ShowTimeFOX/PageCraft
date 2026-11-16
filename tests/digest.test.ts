// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { buildPageDigest } from "@/lib/digest";

describe("buildPageDigest", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    document.head.innerHTML = `
      <style>:root { --brand: #123456; } body { background: rgb(1, 2, 3); color: rgb(9, 9, 9); }</style>
      <style id="pagecraft-custom-style">body { background: rgb(200, 0, 0); }</style>`;
    document.body.innerHTML = `
      <header role="banner" class="site-header css-1x2y3z"><nav aria-label="Main"></nav></header>
      <main id="content">
        <ul class="list">
          <li class="item">One</li><li class="item">Two</li><li class="item">Three</li>
        </ul>
        <input type="password" name="pw" value="secret123">
      </main>
      <script>window.x = 1</script>`;
    document.title = "Docs"; // after replacing <head>, which would drop <title>
  });

  it("describes structure, collapsing repeated siblings and hiding hashed classes", () => {
    const digest = buildPageDigest("pagecraft-custom-style");
    expect(digest.outline).toContain('header.site-header [role="banner"]');
    expect(digest.outline).not.toContain("css-1x2y3z");
    expect(digest.outline).toContain("li.item ×3");
    expect(digest.outline).toContain("main#content");
    expect(digest.outline).not.toContain("script");
  });

  it("never includes text content or form values", () => {
    const json = JSON.stringify(buildPageDigest("pagecraft-custom-style"));
    expect(json).not.toContain("secret123");
    expect(json).not.toContain("Three");
  });

  it("reads site CSS variables and metadata", () => {
    const digest = buildPageDigest("pagecraft-custom-style");
    expect(digest.title).toBe("Docs");
    expect(digest.lang).toBe("en");
    expect(digest.customProperties.some((p) => p.startsWith("--brand"))).toBe(true);
  });

  it("switches PageCraft's own sheet off while measuring, then restores it", () => {
    // happy-dom ignores sheet.disabled in getComputedStyle (browsers honour it), so this only
    // checks the toggle itself. Colour measurement is covered by the manual browser test.
    const own = (document.getElementById("pagecraft-custom-style") as HTMLStyleElement).sheet!;
    const seen: boolean[] = [];
    const original = window.getComputedStyle.bind(window);
    window.getComputedStyle = ((el: Element) => {
      seen.push(own.disabled);
      return original(el);
    }) as typeof window.getComputedStyle;
    try {
      buildPageDigest("pagecraft-custom-style");
    } finally {
      window.getComputedStyle = original;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(own.disabled).toBe(false);
  });
});
