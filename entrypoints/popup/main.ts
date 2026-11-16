import { browser } from "wxt/browser";
import { localizePage, t } from "@/lib/i18n";
import { hasSiteAccess, requestAllSitesAccess, requestSiteAccess } from "@/lib/permissions";
import { findRule, normalizePattern, setHostRule } from "@/lib/rules";
import { getThemeSettings, setThemeSettings, type PresetId, type ThemeSettings } from "@/lib/storage";
import { ensureContentScript } from "@/lib/tabs";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const siteName = $<HTMLParagraphElement>("site-name");
const toggleButton = $<HTMLButtonElement>("toggle-button");
const presetSelect = $<HTMLSelectElement>("preset-select");
const myStylesSelect = $<HTMLSelectElement>("my-styles-select");
const ruleNote = $<HTMLParagraphElement>("rule-note");
const pauseToggle = $<HTMLInputElement>("pause-toggle");
const customStyleButton = $<HTMLButtonElement>("custom-style-button");
const settingsButton = $<HTMLButtonElement>("settings-button");
const status = $<HTMLParagraphElement>("status");
const accessBanner = $<HTMLDivElement>("access-banner");
const grantSiteButton = $<HTMLButtonElement>("grant-site-button");
const grantAllButton = $<HTMLButtonElement>("grant-all-button");

localizePage();

let currentHostname = "";
let currentPath = "/";
let currentTabId: number | undefined;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function setStatus(message: string) {
  status.textContent = message;
}

function renderToggle(enabled: boolean) {
  toggleButton.setAttribute("aria-pressed", String(enabled));
  // The button is a visual switch; the state text lives in its label and tooltip.
  const label = enabled ? t("popupOn") : t("popupOff");
  toggleButton.setAttribute("aria-label", label);
  toggleButton.title = label;
}

function renderSite(data: ThemeSettings) {
  myStylesSelect.replaceChildren(new Option(t("popupNoStyle"), ""));
  for (const style of data.myStyles) myStylesSelect.add(new Option(style.name, style.id));
  if (!currentHostname) return;

  const exact = data.siteRules.find((rule) => rule.enabled && normalizePattern(rule.pattern) === currentHostname);
  const applied = findRule(data.siteRules, currentHostname, currentPath);
  myStylesSelect.value = exact?.styleId ?? "";
  // A broader rule (pattern or global theme) applies when there is no exact-host rule.
  if (applied && applied !== exact) {
    const style = data.myStyles.find((s) => s.id === applied.styleId);
    ruleNote.textContent = t("popupRuleNote", style?.name ?? "?", applied.pattern);
    ruleNote.hidden = false;
  } else {
    ruleNote.hidden = true;
  }
  pauseToggle.checked = data.siteSettings[currentHostname]?.paused === true;
}

async function renderAccess() {
  if (!currentHostname) {
    accessBanner.hidden = true;
    return;
  }
  const granted = await hasSiteAccess(currentHostname).catch(() => false);
  accessBanner.hidden = granted;
  if (granted && currentTabId !== undefined) void ensureContentScript(currentTabId);
}

async function loadPopup() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
    let url: URL | null = null;
    try {
      url = new URL(tab?.url ?? "");
    } catch {
      url = null;
    }
    const isWebPage = url?.protocol === "http:" || url?.protocol === "https:";
    currentHostname = isWebPage && url ? url.hostname : "";
    currentPath = isWebPage && url ? url.pathname : "/";
    siteName.textContent = currentHostname || t("popupNotAWebsite");
    for (const control of [myStylesSelect, customStyleButton, pauseToggle]) control.disabled = !isWebPage;

    const data = await getThemeSettings();
    renderToggle(data.enabled);
    presetSelect.value = data.preset;
    renderSite(data);
    await renderAccess();
  } catch (error) {
    siteName.textContent = t("popupLoadFailed");
    for (const control of [toggleButton, presetSelect, myStylesSelect, customStyleButton, pauseToggle]) control.disabled = true;
    setStatus(errorMessage(error));
  }
}

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  try {
    const enabled = toggleButton.getAttribute("aria-pressed") !== "true";
    await setThemeSettings({ enabled });
    renderToggle(enabled);
    setStatus(enabled ? t("popupEnabled") : t("popupDisabled"));
  } catch (error) {
    setStatus(t("popupSaveFailed", errorMessage(error)));
  } finally {
    toggleButton.disabled = false;
  }
});

presetSelect.addEventListener("change", async () => {
  presetSelect.disabled = true;
  try {
    await setThemeSettings({ preset: presetSelect.value as PresetId });
    setStatus(t("popupPresetSaved"));
  } catch (error) {
    setStatus(t("popupSaveFailed", errorMessage(error)));
  } finally {
    presetSelect.disabled = false;
  }
});

myStylesSelect.addEventListener("change", async () => {
  if (!currentHostname) return;
  myStylesSelect.disabled = true;
  try {
    const data = await getThemeSettings();
    const siteRules = setHostRule(data.siteRules, currentHostname, myStylesSelect.value, () => crypto.randomUUID());
    await setThemeSettings({ siteRules });
    renderSite({ ...data, siteRules });
    setStatus(myStylesSelect.value ? t("popupStyleApplied") : t("popupStyleRemoved"));
  } catch (error) {
    setStatus(t("popupSaveFailed", errorMessage(error)));
  } finally {
    myStylesSelect.disabled = false;
  }
});

pauseToggle.addEventListener("change", async () => {
  if (!currentHostname) return;
  try {
    const { siteSettings } = await getThemeSettings();
    const override = { ...(siteSettings[currentHostname] ?? {}), paused: pauseToggle.checked || undefined };
    if (Object.values(override).every((v) => v === undefined)) delete siteSettings[currentHostname];
    else siteSettings[currentHostname] = override;
    await setThemeSettings({ siteSettings });
    setStatus(pauseToggle.checked ? t("popupPaused") : t("popupResumed"));
  } catch (error) {
    setStatus(t("popupSaveFailed", errorMessage(error)));
  }
});

customStyleButton.addEventListener("click", async () => {
  if (!currentHostname) return;
  customStyleButton.disabled = true;
  try {
    const { siteRules } = await getThemeSettings();
    const rule = findRule(siteRules, currentHostname, currentPath);
    const params = new URLSearchParams({
      hostname: currentHostname,
      styleId: rule?.styleId ?? "",
      tabId: String(currentTabId ?? ""),
    });
    await browser.tabs.create({ url: `${browser.runtime.getURL("/editor.html")}?${params}` });
    window.close();
  } catch (error) {
    setStatus(t("popupEditorFailed", errorMessage(error)));
    customStyleButton.disabled = false;
  }
});

function afterGrant(granted: boolean) {
  setStatus(granted ? t("popupAccessGranted") : t("popupAccessDenied"));
  if (granted) void renderAccess();
}

// permissions.request must be the first call inside the click (user gesture).
grantSiteButton.addEventListener("click", () => {
  if (!currentHostname) return;
  requestSiteAccess(currentHostname).then(afterGrant, (error) => setStatus(errorMessage(error)));
});
grantAllButton.addEventListener("click", () => {
  requestAllSitesAccess().then(afterGrant, (error) => setStatus(errorMessage(error)));
});

settingsButton.addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

loadPopup();
