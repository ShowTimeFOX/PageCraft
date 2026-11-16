import { t } from "@/lib/i18n";
import { getStoredAiSettings, setAiSettings } from "@/lib/storage";
import { createVault, lockVault, unlockedKeys, unlockVault } from "@/lib/vault";
import { currentKeys, loadAiSection } from "./ai-section";
import { $, errorMessage, setStatus } from "./ui";

const state = $<HTMLParagraphElement>("vault-state");
const createForm = $<HTMLFormElement>("vault-create");
const pass1 = $<HTMLInputElement>("vault-pass-1");
const pass2 = $<HTMLInputElement>("vault-pass-2");
const unlockForm = $<HTMLFormElement>("vault-unlock");
const passInput = $<HTMLInputElement>("vault-pass");
const unlockedActions = $<HTMLDivElement>("vault-unlocked");
const lockButton = $<HTMLButtonElement>("vault-lock");
const removeButton = $<HTMLButtonElement>("vault-remove");
const status = $<HTMLParagraphElement>("vault-status");

export async function renderVault() {
  const { vault } = await getStoredAiSettings();
  const unlocked = vault ? (await unlockedKeys(vault)) !== null : false;
  state.textContent = !vault ? t("optionsVaultOff") : unlocked ? t("optionsVaultUnlocked") : t("optionsVaultLocked");
  createForm.hidden = Boolean(vault);
  unlockForm.hidden = !vault || unlocked;
  unlockedActions.hidden = !vault || !unlocked;
}

async function refreshAll(message: string) {
  await loadAiSection();
  await renderVault();
  setStatus(status, message);
}

export function initVaultSection() {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (pass1.value !== pass2.value) throw new Error(t("optionsPassphraseMismatch"));
      setStatus(status, t("optionsEncrypting"));
      const settings = await getStoredAiSettings();
      const vault = await createVault(pass1.value, currentKeys());
      for (const config of Object.values(settings.providers)) config.apiKey = "";
      await setAiSettings({ ...settings, vault });
      pass1.value = pass2.value = "";
      await refreshAll(t("optionsVaultCreated"));
    } catch (error) {
      setStatus(status, errorMessage(error), true);
    }
  });

  unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { vault } = await getStoredAiSettings();
      if (!vault) return;
      setStatus(status, t("optionsUnlocking"));
      await unlockVault(vault, passInput.value);
      passInput.value = "";
      await refreshAll(t("optionsVaultUnlockedStatus"));
    } catch (error) {
      setStatus(status, errorMessage(error), true);
    }
  });

  lockButton.addEventListener("click", async () => {
    await lockVault();
    await refreshAll(t("optionsVaultLockedStatus"));
  });

  removeButton.addEventListener("click", async () => {
    if (!window.confirm(t("optionsRemoveProtectionConfirm"))) return;
    try {
      const settings = await getStoredAiSettings();
      if (!settings.vault) return;
      const keys = await unlockedKeys(settings.vault);
      if (!keys) throw new Error(t("optionsUnlockFirst"));
      for (const [id, config] of Object.entries(settings.providers)) config.apiKey = keys[id] ?? "";
      await setAiSettings({ ...settings, vault: null });
      await lockVault();
      await refreshAll(t("optionsVaultRemoved"));
    } catch (error) {
      setStatus(status, errorMessage(error), true);
    }
  });
}
