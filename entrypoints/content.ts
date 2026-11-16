import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { scanContrast } from "@/lib/contrast-scan";
import { buildPageDigest } from "@/lib/digest";
import { StyleInjector, STYLE_ID } from "@/lib/injector";
import { PREVIEW_PORT, type ContentRequest, type PreviewMessage } from "@/lib/messages";
import { presets } from "@/lib/presets";
import { findRule } from "@/lib/rules";
import { getThemeSettings, themeKeys, type ThemeSettings } from "@/lib/storage";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  // Not in the manifest: the background registers this script only for sites the user has
  // granted access to (see entrypoints/background.ts), and tabs inject it on demand.
  registration: "runtime",
  main() {
    const hostname = window.location.hostname;
    const isTopFrame = window.top === window;
    const injector = new StyleInjector();
    let settings: ThemeSettings | null = null;
    /** CSS from an open editor; replaces the matched style while previewing (top frame only). */
    let previewCss: string | null = null;
    /** Preview is mirrored into same-origin iframes, which the top frame can reach directly. */
    const framePreviews = new Map<Document, StyleInjector>();

    function effective(current: ThemeSettings) {
      const override = current.siteSettings[hostname] ?? {};
      return {
        paused: override.paused === true,
        frames: override.frames ?? current.injection.frames,
        shadowRoots: override.shadowRoots ?? current.injection.shadowRoots,
      };
    }

    function render() {
      if (!settings) return;
      const options = effective(settings);
      if (!settings.enabled || options.paused || (!isTopFrame && !options.frames)) {
        injector.setCss("");
        return;
      }
      const rule = findRule(settings.siteRules, hostname, window.location.pathname);
      const matched = rule ? settings.myStyles.find((s) => s.id === rule.styleId) : undefined;
      const presetCss = settings.preset !== "none" ? presets[settings.preset] : "";
      injector.setShadowRoots(options.shadowRoots);
      injector.setCss(
        [presetCss, settings.styles[hostname] ?? "", previewCss ?? matched?.css ?? ""].filter(Boolean).join("\n"),
      );
      if (isTopFrame) syncFramePreviews(options.frames);
    }

    /** Apply the editor preview inside same-origin iframes; their own content scripts restore saved CSS after. */
    function syncFramePreviews(framesEnabled: boolean) {
      const css = previewCss !== null && framesEnabled ? injector.styleElement?.textContent ?? "" : null;
      const live = new Set<Document>();
      if (css !== null) {
        for (const frame of Array.from(document.querySelectorAll("iframe"))) {
          let doc: Document | null = null;
          try {
            doc = frame.contentDocument; // null or throws for cross-origin frames
            if (doc && doc.location.hostname !== hostname) doc = null;
          } catch {
            doc = null;
          }
          if (!doc) continue;
          live.add(doc);
          let frameInjector = framePreviews.get(doc);
          if (!frameInjector) {
            frameInjector = new StyleInjector(doc);
            framePreviews.set(doc, frameInjector);
          }
          frameInjector.setCss(css);
        }
      }
      for (const [doc, frameInjector] of framePreviews) {
        if (live.has(doc)) continue;
        // Removing our element lets the frame's own content script re-add its saved CSS.
        frameInjector.setCss("");
        framePreviews.delete(doc);
      }
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

    // Single-page apps change paths without reloading; path-scoped rules need a re-check.
    let lastPath = window.location.pathname;
    const checkPath = () => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        render();
      }
    };
    window.addEventListener("popstate", checkPath);
    window.setInterval(checkPath, 1000);

    // Editor requests target the top frame only (frameId 0).
    if (isTopFrame) {
      browser.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
        if (message?.type === "pagecraft:get-digest") sendResponse(buildPageDigest(STYLE_ID, message.size));
        else if (message?.type === "pagecraft:contrast") sendResponse(scanContrast());
        else if (message?.type === "pagecraft:ping") sendResponse("pong");
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
    }

    // <head> may not exist yet at document_start.
    document.addEventListener("DOMContentLoaded", () => injector.ensurePlaced(), { once: true });
    refresh();
  },
});
