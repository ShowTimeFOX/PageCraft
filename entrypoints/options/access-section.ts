import { browser } from "wxt/browser";
import { t } from "@/lib/i18n";
import { grantedSites, removeSiteAccess, requestAllSitesAccess } from "@/lib/permissions";
import { isValidPattern } from "@/lib/rules";
import { getThemeSettings, setThemeSettings, type SiteOverride } from "@/lib/storage";
import { $, button, errorMessage, setStatus } from "./ui";

const state = $<HTMLParagraphElement>("access-state");
const accessList = $<HTMLUListElement>("access-list");
const allButton = $<HTMLButtonElement>("access-all");
const restrictButton = $<HTMLButtonElement>("access-restrict");
const framesToggle = $<HTMLInputElement>("frames-toggle");
const shadowToggle = $<HTMLInputElement>("shadow-toggle");
const overrideBody = document.querySelector<HTMLTableSectionElement>("#override-table tbody")!;
const overrideForm = $<HTMLFormElement>("override-add");
const overrideHost = $<HTMLInputElement>("override-host");
const status = $<HTMLParagraphElement>("access-status");

async function renderAccess() {
  const { all, hosts } = await grantedSites();
  state.textContent = all ? t("optionsAccessAll") : hosts.length ? t("optionsAccessSome", hosts.length) : t("optionsAccessNone");
  allButton.hidden = all;
  restrictButton.hidden = !all;
  accessList.replaceChildren(
    ...hosts.map((host) => {
      const chip = document.createElement("li");
      chip.className = "chip";
      const label = document.createElement("span");
      label.textContent = host;
      const remove = button("×", "");
      remove.title = t("optionsRevokeSite");
      remove.setAttribute("aria-label", `${t("optionsRevokeSite")}: ${host}`);
      remove.disabled = all;
      remove.addEventListener("click", async () => {
        await removeSiteAccess(host);
        setStatus(status, t("optionsSiteRevoked", host));
        await renderAccess();
      });
      chip.append(label, remove);
      return chip;
    }),
  );
}

/** Tri-state select: inherit the global setting, force on, force off. */
function triState(value: boolean | undefined, onChange: (next: boolean | undefined) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.add(new Option(t("optionsDefault"), ""));
  select.add(new Option(t("optionsOn"), "on"));
  select.add(new Option(t("optionsOffValue"), "off"));
  select.value = value === undefined ? "" : value ? "on" : "off";
  select.addEventListener("change", () => onChange(select.value === "" ? undefined : select.value === "on"));
  return select;
}

async function updateOverride(host: string, patch: Partial<SiteOverride> | null) {
  const { siteSettings } = await getThemeSettings();
  if (patch === null) {
    delete siteSettings[host];
  } else {
    const next = { ...(siteSettings[host] ?? {}), ...patch };
    for (const key of Object.keys(next) as (keyof SiteOverride)[]) if (next[key] === undefined) delete next[key];
    siteSettings[host] = next;
  }
  await setThemeSettings({ siteSettings });
}

async function renderOverrides() {
  const { siteSettings } = await getThemeSettings();
  const hosts = Object.keys(siteSettings).sort();
  overrideBody.replaceChildren(
    ...hosts.map((host) => {
      const override = siteSettings[host] ?? {};
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = host;

      const pausedCell = document.createElement("td");
      const paused = document.createElement("input");
      paused.type = "checkbox";
      paused.checked = override.paused === true;
      paused.setAttribute("aria-label", `${t("optionsPaused")}: ${host}`);
      paused.addEventListener("change", () => void updateOverride(host, { paused: paused.checked || undefined }));
      pausedCell.append(paused);

      const framesCell = document.createElement("td");
      framesCell.append(triState(override.frames, (frames) => void updateOverride(host, { frames })));
      const shadowCell = document.createElement("td");
      shadowCell.append(triState(override.shadowRoots, (shadowRoots) => void updateOverride(host, { shadowRoots })));

      const removeCell = document.createElement("td");
      const remove = button("×");
      remove.setAttribute("aria-label", `${t("optionsRemove")}: ${host}`);
      remove.addEventListener("click", async () => {
        await updateOverride(host, null);
        await renderOverrides();
      });
      removeCell.append(remove);

      row.append(name, pausedCell, framesCell, shadowCell, removeCell);
      return row;
    }),
  );
}

export async function loadAccessSection() {
  const { injection } = await getThemeSettings();
  framesToggle.checked = injection.frames;
  shadowToggle.checked = injection.shadowRoots;
  await Promise.all([renderAccess(), renderOverrides()]);
}

export function initAccessSection() {
  // permissions.request must be the first call inside the click (user gesture).
  allButton.addEventListener("click", () => {
    requestAllSitesAccess()
      .then(async (granted) => {
        setStatus(status, granted ? t("optionsAllGranted") : t("popupAccessDenied"));
        await renderAccess();
      })
      .catch((error) => setStatus(status, errorMessage(error), true));
  });

  restrictButton.addEventListener("click", async () => {
    await browser.permissions.remove({ origins: ["<all_urls>"] });
    setStatus(status, t("optionsRestricted"));
    await renderAccess();
  });

  const saveInjection = async () => {
    try {
      await setThemeSettings({ injection: { frames: framesToggle.checked, shadowRoots: shadowToggle.checked } });
      setStatus(status, t("optionsInjectionSaved"));
    } catch (error) {
      setStatus(status, t("optionsSaveFailed", errorMessage(error)), true);
    }
  };
  framesToggle.addEventListener("change", saveInjection);
  shadowToggle.addEventListener("change", saveInjection);

  overrideForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const host = overrideHost.value.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
    if (!host || host.includes("*") || !isValidPattern(host)) {
      setStatus(status, t("optionsInvalidHost", overrideHost.value), true);
      return;
    }
    const { siteSettings } = await getThemeSettings();
    if (!siteSettings[host]) await updateOverride(host, {});
    overrideHost.value = "";
    await renderOverrides();
  });

  browser.permissions.onAdded.addListener(() => void renderAccess());
  browser.permissions.onRemoved.addListener(() => void renderAccess());
}
