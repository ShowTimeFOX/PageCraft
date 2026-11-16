import { describe, expect, it } from "vitest";
import { describeVersion, saveWithHistory } from "@/lib/history";
import type { MyStyle } from "@/lib/storage";

describe("saveWithHistory", () => {
  const base: MyStyle = { id: "1", name: "A", css: "a{color:red}", prompt: "red", updatedAt: 1000 };

  it("moves the previous CSS into history on change", () => {
    const saved = saveWithHistory(base, { id: "1", name: "A", css: "a{color:blue}", updatedAt: 2000 });
    expect(saved.css).toBe("a{color:blue}");
    expect(saved.history).toEqual([{ css: "a{color:red}", prompt: "red", savedAt: 1000 }]);
  });

  it("does not add a version when the CSS is unchanged", () => {
    const saved = saveWithHistory(base, { id: "1", name: "Renamed", css: base.css, updatedAt: 2000 });
    expect(saved.history).toEqual([]);
    expect(saved.name).toBe("Renamed");
  });

  it("caps history length, newest first", () => {
    let style: MyStyle = base;
    for (let i = 0; i < 5; i++) {
      style = saveWithHistory(style, { id: "1", name: "A", css: `a{z-index:${i}}`, updatedAt: 2000 + i }, 3);
    }
    expect(style.history).toHaveLength(3);
    expect(style.history?.[0]?.css).toBe("a{z-index:3}");
  });

  it("starts empty for a new style", () => {
    expect(saveWithHistory(undefined, { id: "2", name: "B", css: "b{}" }).history).toEqual([]);
  });

  it("describes versions relative to now", () => {
    expect(describeVersion({ css: "a{}", prompt: "warm dark", savedAt: 0 }, 5 * 60_000)).toBe("5 min ago · warm dark");
  });
});
