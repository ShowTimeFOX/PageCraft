import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: "PageCraft",
    description: "Create custom CSS themes for the websites you visit, by hand or with AI.",
    icons: { 128: "icon.png" },
    permissions: ["storage", "activeTab"],
    // Needed so the content script can apply themes everywhere, and so extension
    // pages can call AI provider APIs (including localhost) without CORS errors.
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "Style this page with PageCraft",
      default_icon: "icon.png",
    },
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: { id: "pagecraft@pagecraft.app", strict_min_version: "109.0" },
      },
    }),
  }),
});
