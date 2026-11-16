import { describe, expect, it } from "vitest";
import { originPattern } from "@/lib/permissions";

describe("originPattern", () => {
  it("builds a host match pattern without port or path", () => {
    expect(originPattern("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/*");
    expect(originPattern("http://localhost:11434/v1")).toBe("http://localhost/*");
  });

  it("rejects non-http URLs and garbage", () => {
    expect(originPattern("file:///etc")).toBeNull();
    expect(originPattern("not a url")).toBeNull();
  });
});
