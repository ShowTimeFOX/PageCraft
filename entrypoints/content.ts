import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { PREVIEW_PORT, type ContentRequest, type PreviewMessage } from "@/lib/messages";
import { presets } from "@/lib/presets";
import { getThemeSettings, themeKeys, type ThemeSettings } from "@/lib/storage";
import { buildPageDigest } from "@/lib/digest";

const STYLE_ID = "pagecraft-custom-style";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const hostname = window.location.hostname;
    let settings: ThemeSettings | null = null;
    /** CSS from an open editor; replaces the selected style while previewing. */
    let previewCss: string | null = null;

    function render() {
      if (!settings) return;
      const existing = document.getElementById(STYLE_ID);
      if (!settings.enabled) {
        existing?.remove();
        return;
      }
      const selectedId = settings.selectedMyStyles[hostname];
      const selected = settings.myStyles.find((s) => s.id === selectedId);
      const presetCss = settings.preset !== "none" ? presets[settings.preset] : "";
      const css = [presetCss, settings.styles[hostname] ?? "", previewCss ?? selected?.css ?? ""]
        .filter(Boolean)
        .join("\n");

      if (!css) {
        existing?.remove();
        return;
      }
      let style = existing as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
      }
      style.textContent = css;
      // Keep our sheet last so it wins cascade ties against site styles added later.
      const parent = document.head || document.documentElement;
      if (style.parentNode !== parent || style !== parent.lastElementChild) parent.append(style);
    }

    async function refresh() {
      try {
        settings = await getThemeSettings();
        render();
      } catch (error) {
        console.error("PageCraft could not load saved styles.", error);
      }
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && themeKeys.some((key) => key in changes)) refresh();
    });

    browser.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
      if (message?.type === "pagecraft:get-digest") {
        sendResponse(buildPageDigest(STYLE_ID));
      }
      return false;
    });

    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== PREVIEW_PORT) return;
      port.onMessage.addListener((message: PreviewMessage) => {
        previewCss = message.type === "set" ? message.css : null;
        render();
      });
      port.onDisconnect.addListener(() => {
        previewCss = null;
        render();
      });
    });

    // <head> may not exist yet at document_start; re-append once it does.
    document.addEventListener("DOMContentLoaded", render, { once: true });
    refresh();
  },
});
