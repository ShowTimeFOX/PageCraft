import { browser } from "wxt/browser";
import { localizePage, t } from "@/lib/i18n";
import { initAccessSection, loadAccessSection } from "./access-section";
import { initAiSection, loadAiSection } from "./ai-section";
import { initThemesSection, renderThemes } from "./themes-section";
import { $, errorMessage, setStatus } from "./ui";
import { initVaultSection, renderVault } from "./vault-section";

localizePage();
initAiSection();
initVaultSection();
initThemesSection();
initAccessSection();

// Keep the theme list current when the editor or popup changes styles in another tab.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("myStyles" in changes || "siteRules" in changes)) void renderThemes();
});

Promise.all([loadAiSection(), renderVault(), renderThemes(), loadAccessSection()]).catch((error) =>
  setStatus($("status"), t("optionsLoadFailed", errorMessage(error)), true),
);
