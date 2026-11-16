/**
 * Localisation via the browser's i18n API (public/_locales/<lang>/messages.json).
 *
 * - t("key", ...args) returns the message for the browser's UI language, replacing {0}, {1}, …
 *   Keys are type-checked against the English catalog.
 * - localizePage() fills elements marked with data-i18n (text), data-i18n-title,
 *   data-i18n-placeholder and data-i18n-aria-label.
 */
import { browser } from "wxt/browser";
import catalog from "@/public/_locales/en/messages.json";

export type MessageKey = keyof typeof catalog;

export function t(key: MessageKey, ...args: (string | number)[]): string {
  let message = "";
  try {
    message = browser.i18n?.getMessage(key) ?? "";
  } catch {
    // i18n unavailable (tests); fall back to the English catalog
  }
  if (!message) message = catalog[key]?.message ?? key;
  return args.reduce<string>((text, arg, index) => text.replaceAll(`{${index}}`, String(arg)), message);
}

const ATTRIBUTES = [
  ["data-i18n-title", "title"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-aria-label", "aria-label"],
] as const;

export function localizePage(root: ParentNode = document) {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-i18n]"))) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
  for (const [data, attribute] of ATTRIBUTES) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${data}]`))) {
      el.setAttribute(attribute, t(el.getAttribute(data) as MessageKey));
    }
  }
  const lang = browser.i18n?.getUILanguage?.();
  if (lang && root === document) document.documentElement.lang = lang;
}
