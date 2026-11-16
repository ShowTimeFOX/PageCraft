import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

/**
 * PageCraft asks for no website access at install. When the user grants a site (or all sites)
 * from the popup, the content script is registered for exactly those origins, so themes apply
 * from document_start on every later page load.
 */
const SCRIPT_ID = "pagecraft-content";

async function syncContentScript() {
  const { origins = [] } = await browser.permissions.getAll();
  const matches = origins.filter((origin) => origin === "<all_urls>" || /^(?:https?|\*):\/\//.test(origin));
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });

  if (!matches.length) {
    if (registered.length) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }

  const script = {
    id: SCRIPT_ID,
    matches,
    js: ["content-scripts/content.js"],
    runAt: "document_start" as const,
    allFrames: true,
  };
  const apply = (withPersistence: boolean) => {
    const value = withPersistence ? { ...script, persistAcrossSessions: true } : script;
    return registered.length
      ? browser.scripting.updateContentScripts([value])
      : browser.scripting.registerContentScripts([value]);
  };
  try {
    await apply(true);
  } catch {
    // Older Firefox versions reject persistAcrossSessions; onStartup re-registers there.
    await apply(false);
  }
}

export default defineBackground(() => {
  const sync = () => syncContentScript().catch((error) => console.error("PageCraft: content script sync failed", error));
  browser.runtime.onInstalled.addListener(sync);
  browser.runtime.onStartup.addListener(sync);
  browser.permissions.onAdded.addListener(sync);
  browser.permissions.onRemoved.addListener(sync);
});
