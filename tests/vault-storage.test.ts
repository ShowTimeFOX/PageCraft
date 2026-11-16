import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { getAiSettings, getStoredAiSettings, getThemeSettings, setAiSettings } from "@/lib/storage";
import { createVault, lockVault, unlockedKeys, unlockVault, updateVault } from "@/lib/vault";

// Fast key derivation for tests; production uses PBKDF2_ITERATIONS.
const ITERATIONS = 1_000;

beforeEach(async () => {
  fakeBrowser.reset();
  await lockVault();
});

describe("vault", () => {
  it("encrypts, unlocks with the right passphrase and rejects a wrong one", async () => {
    const vault = await createVault("correct horse", { anthropic: "sk-ant-123" }, ITERATIONS);
    expect(JSON.stringify(vault)).not.toContain("sk-ant-123");
    expect(await unlockedKeys(vault)).toEqual({ anthropic: "sk-ant-123" });

    await lockVault();
    expect(await unlockedKeys(vault)).toBeNull();
    await expect(unlockVault(vault, "wrong passphrase")).rejects.toThrow("Wrong passphrase.");
    expect(await unlockVault(vault, "correct horse")).toEqual({ anthropic: "sk-ant-123" });
    expect(await unlockedKeys(vault)).toEqual({ anthropic: "sk-ant-123" });
  });

  it("re-encrypts updates with the session key and refuses while locked", async () => {
    const vault = await createVault("correct horse", { openai: "a" }, ITERATIONS);
    const updated = await updateVault(vault, { openai: "b" });
    expect(updated.iv).not.toBe(vault.iv);
    expect(await unlockedKeys(updated)).toEqual({ openai: "b" });
    await lockVault();
    await expect(updateVault(updated, { openai: "c" })).rejects.toThrow(/Unlock/);
  });

  it("requires a reasonable passphrase", async () => {
    await expect(createVault("short", {}, ITERATIONS)).rejects.toThrow(/8 characters/);
  });

  it("fills API keys in getAiSettings only while unlocked", async () => {
    const stored = await getStoredAiSettings();
    const vault = await createVault("correct horse", { anthropic: "sk-ant-xyz" }, ITERATIONS);
    await setAiSettings({ ...stored, vault });
    expect((await getAiSettings()).providers.anthropic.apiKey).toBe("sk-ant-xyz");
    await lockVault();
    expect((await getAiSettings()).providers.anthropic.apiKey).toBe("");
  });
});

describe("storage migration", () => {
  it("builds site rules from the 1.x hostname map until rules are saved", async () => {
    await fakeBrowser.storage.local.set({ selectedMyStyles: { "example.com": "s1" }, myStyles: [{ id: "s1", name: "A", css: "a{}" }] });
    const settings = await getThemeSettings();
    expect(settings.siteRules.map((r) => [r.pattern, r.styleId])).toEqual([["example.com", "s1"]]);

    await fakeBrowser.storage.local.set({ siteRules: [] });
    expect((await getThemeSettings()).siteRules).toEqual([]);
  });

  it("defaults new settings", async () => {
    const settings = await getThemeSettings();
    expect(settings.siteSettings).toEqual({});
    expect(settings.injection).toEqual({ frames: true, shadowRoots: false });
    const ai = await getStoredAiSettings();
    expect(ai.digestSize).toBe("normal");
    expect(ai.vault).toBeNull();
  });
});
