import { browser } from "wxt/browser";
import type { ContentRequest } from "./messages";

/**
 * Make sure PageCraft's content script is running in a tab.
 *
 * Tabs that were open before the extension was installed (or updated, in Chrome) have no
 * live content script, so digest requests and previews would silently fail. Ping first, and
 * inject the manifest's content script only when nothing answers.
 */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    const reply = await browser.tabs.sendMessage(tabId, { type: "pagecraft:ping" } satisfies ContentRequest, { frameId: 0 });
    if (reply === "pong") return true;
  } catch {
    // No receiver: inject below.
  }
  try {
    // Typed by WXT: renaming entrypoints/content.ts turns this into a compile error.
    await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["/content-scripts/content.js"] });
    return true;
  } catch {
    // Restricted page (browser store, about:, PDF viewer) or no host permission.
    return false;
  }
}
