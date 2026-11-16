// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StyleInjector, STYLE_ID } from "@/lib/injector";

const flush = async (ms = 500) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("StyleInjector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = "<style>body{color:red}</style>";
    document.body.innerHTML = "";
  });

  afterEach(() => vi.useRealTimers());

  it("adds a style element last in <head> and removes it for empty CSS", () => {
    const injector = new StyleInjector();
    injector.setCss("body{color:blue}");
    expect(document.head.lastElementChild?.id).toBe(STYLE_ID);
    expect(document.getElementById(STYLE_ID)?.textContent).toBe("body{color:blue}");
    injector.setCss("");
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("re-adds the element when a head manager removes it", async () => {
    const injector = new StyleInjector();
    injector.setCss("a{}");
    document.getElementById(STYLE_ID)?.remove();
    await flush();
    expect(document.getElementById(STYLE_ID)?.textContent).toBe("a{}");
    injector.setCss("");
  });

  it("moves back to last place when the site appends styles after it", async () => {
    const injector = new StyleInjector();
    injector.setCss("a{}");
    document.head.append(document.createElement("style"));
    await flush();
    expect(document.head.lastElementChild?.id).toBe(STYLE_ID);
    injector.setCss("");
  });

  it("mirrors CSS into open shadow roots only when enabled", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>hi</p>";

    const injector = new StyleInjector();
    injector.setCss("p{color:green}");
    expect(shadow.querySelector("style[data-pagecraft]")).toBeNull();

    injector.setShadowRoots(true);
    expect(shadow.querySelector("style[data-pagecraft]")?.textContent).toBe("p{color:green}");

    injector.setCss("p{color:blue}");
    expect(shadow.querySelector("style[data-pagecraft]")?.textContent).toBe("p{color:blue}");

    injector.setShadowRoots(false);
    expect(shadow.querySelector("style[data-pagecraft]")).toBeNull();
    injector.setCss("");
  });
});
