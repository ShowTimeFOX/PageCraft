import { defineConfig } from "wxt";

const icons = { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 96: "icon/96.png", 128: "icon/128.png" };

export default defineConfig({
  manifestVersion: 3,
  zip: {
    // The sources zip is for AMO review: keep what's needed to rebuild, drop design assets.
    excludeSources: ["design/**", ".github/**"],
  },
  hooks: {
    // WXT adds a runtime-registered content script's matches to host_permissions. PageCraft keeps
    // all website access optional instead (granted per site from the popup), so drop them again.
    "build:manifestGenerated": (_wxt, manifest) => {
      delete manifest.host_permissions;
    },
  },
  manifest: ({ browser }) => ({
    // Localised from public/_locales/<lang>/messages.json.
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    icons,
    // scripting: register the content script for granted sites and inject it into open tabs.
    permissions: ["storage", "activeTab", "scripting"],
    // No website access at install. Users enable single sites or all sites from the popup;
    // provider API hosts (including localhost) are requested when first contacted.
    optional_host_permissions: ["<all_urls>"],
    action: {
      default_title: "__MSG_extActionTitle__",
      default_icon: icons,
    },
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "pagecraft@pagecraft.app",
          // optional_host_permissions needs Firefox 128+.
          strict_min_version: "128.0",
          // Required for new AMO listings. On Generate, the page URL and a structural digest
          // of the page are sent to the AI provider the user configured.
          data_collection_permissions: {
            required: ["websiteContent", "browsingActivity"],
          },
        },
      },
    }),
  }),
});
