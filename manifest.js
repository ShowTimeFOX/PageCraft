const fs = require("node:fs");
const path = require("node:path");

const manifest = {
  manifest_version: 3,
  name: "PageCraft",
  version: "1.0.0",
  description: "Create custom CSS styles for the websites you visit.",
  permissions: ["storage", "activeTab"],
  host_permissions: ["<all_urls>"],
  action: {
    default_title: "Style this page with PageCraft",
    default_popup: "popup.html",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      run_at: "document_start",
    },
  ],
  browser_specific_settings: {
    gecko: {
      id: "pagecraft@pagecraft.app",
      strict_min_version: "109.0",
    },
  },
};

const outputPath = path.join(__dirname, "manifest.json");
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${outputPath}`);
