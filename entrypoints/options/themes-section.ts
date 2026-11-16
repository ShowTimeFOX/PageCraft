import { createBackup, mergeBackup, parseBackup } from "@/lib/backup";
import { t } from "@/lib/i18n";
import { normalizePattern, type SiteRule } from "@/lib/rules";
import { getThemeSettings, setThemeSettings, type MyStyle } from "@/lib/storage";
import { $, button, download, errorMessage, setStatus } from "./ui";

const list = $<HTMLDivElement>("theme-list");
const empty = $<HTMLParagraphElement>("theme-empty");
const exportButton = $<HTMLButtonElement>("export-button");
const importInput = $<HTMLInputElement>("import-file");
const status = $<HTMLParagraphElement>("themes-status");

const today = () => new Date().toISOString().slice(0, 10);
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "style";

async function save(styles: MyStyle[], rules: SiteRule[], message: string) {
  await setThemeSettings({ myStyles: styles, siteRules: rules });
  setStatus(status, message);
  await renderThemes();
}

function ruleChip(rule: SiteRule, onRemove: () => void, onToggle: () => void): HTMLLIElement {
  const chip = document.createElement("li");
  chip.className = `chip${rule.enabled ? "" : " disabled"}`;
  const label = document.createElement("span");
  label.textContent = rule.pattern === "*" ? t("optionsEverySite") : rule.pattern;
  const toggle = button(rule.enabled ? "⏸" : "▶", "");
  toggle.title = rule.enabled ? t("optionsDisableRule") : t("optionsEnableRule");
  toggle.setAttribute("aria-label", `${toggle.title}: ${rule.pattern}`);
  toggle.addEventListener("click", onToggle);
  const remove = button("×", "");
  remove.title = t("optionsRemoveRule");
  remove.setAttribute("aria-label", `${t("optionsRemoveRule")}: ${rule.pattern}`);
  remove.addEventListener("click", onRemove);
  chip.append(label, toggle, remove);
  return chip;
}

export async function renderThemes() {
  const { myStyles, siteRules } = await getThemeSettings();
  empty.hidden = myStyles.length > 0;
  exportButton.disabled = myStyles.length === 0;
  list.replaceChildren(
    ...myStyles.map((style) => {
      const card = document.createElement("article");
      card.className = "theme-card";

      const header = document.createElement("header");
      const title = document.createElement("h4");
      title.textContent = style.name;
      const actions = document.createElement("div");
      const exportOne = button(t("optionsExportOne"));
      exportOne.addEventListener("click", () =>
        download(`pagecraft-${slug(style.name)}.json`, JSON.stringify(createBackup([style], siteRules), null, 2)),
      );
      const remove = button(t("optionsDeleteStyle"));
      remove.addEventListener("click", async () => {
        if (!window.confirm(t("optionsDeleteStyleConfirm", style.name))) return;
        await save(
          myStyles.filter((s) => s.id !== style.id),
          siteRules.filter((r) => r.styleId !== style.id),
          t("optionsStyleDeleted", style.name),
        );
      });
      actions.append(exportOne, " ", remove);
      header.append(title, actions);

      const rules = siteRules.filter((rule) => rule.styleId === style.id);
      const chips = document.createElement("ul");
      chips.className = "chip-list";
      chips.setAttribute("aria-label", t("optionsAppliesTo"));
      for (const rule of rules) {
        chips.append(
          ruleChip(
            rule,
            () => void save(myStyles, siteRules.filter((r) => r.id !== rule.id), t("optionsRuleRemoved", rule.pattern)),
            () =>
              void save(
                myStyles,
                siteRules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
                rule.enabled ? t("optionsRuleDisabled", rule.pattern) : t("optionsRuleEnabled", rule.pattern),
              ),
          ),
        );
      }
      if (!rules.length) {
        const none = document.createElement("li");
        none.className = "help";
        none.textContent = t("optionsNotApplied");
        chips.append(none);
      }

      const add = document.createElement("form");
      add.className = "row";
      const input = document.createElement("input");
      input.type = "text";
      input.spellcheck = false;
      input.placeholder = t("optionsPatternPlaceholder");
      input.setAttribute("aria-label", t("optionsAddPatternFor", style.name));
      const addButton = button(t("optionsAddPattern"));
      addButton.type = "submit";
      const everywhere = button(t("optionsApplyEverywhere"));
      everywhere.addEventListener("click", () => addRule("*"));
      add.append(input, addButton, everywhere);

      const addRule = (raw: string) => {
        const pattern = normalizePattern(raw);
        if (!pattern) {
          setStatus(status, t("optionsInvalidPattern", raw), true);
          return;
        }
        // One style per pattern: a new rule replaces any rule with the same pattern.
        const others = siteRules.filter((r) => normalizePattern(r.pattern) !== pattern);
        void save(myStyles, [...others, { id: crypto.randomUUID(), styleId: style.id, pattern, enabled: true }], t("optionsRuleAdded", style.name, pattern));
      };
      add.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input.value.trim()) addRule(input.value);
      });

      card.append(header, chips, add);
      return card;
    }),
  );
}

export function initThemesSection() {
  exportButton.addEventListener("click", async () => {
    const { myStyles, siteRules } = await getThemeSettings();
    download(`pagecraft-themes-${today()}.json`, JSON.stringify(createBackup(myStyles, siteRules), null, 2));
    setStatus(status, t("optionsExported", myStyles.length));
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error(t("optionsImportTooLarge"));
      const parsed = parseBackup(await file.text());
      const { myStyles, siteRules } = await getThemeSettings();
      const result = mergeBackup({ styles: myStyles, rules: siteRules }, parsed);
      await setThemeSettings({ myStyles: result.styles, siteRules: result.rules });
      await renderThemes();
      setStatus(
        status,
        [t("optionsImported", result.added, result.updated), ...parsed.warnings].join(" "),
        parsed.warnings.length > 0,
      );
    } catch (error) {
      setStatus(status, t("optionsImportFailed", errorMessage(error)), true);
    }
  });
}
