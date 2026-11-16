/**
 * Import / export of themes and site rules as JSON.
 *
 * Exports never include API keys or AI settings. Imported CSS is untrusted (it may come from
 * someone else), so it goes through the same sanitizer as AI output.
 */
import { sanitizeCss } from "./ai/sanitize";
import { normalizePattern, type SiteRule } from "./rules";
import type { MyStyle } from "./storage";

export const BACKUP_FORMAT = "pagecraft-themes";
const MAX_STYLES = 500;
const MAX_CSS_LENGTH = 300_000;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  styles: Pick<MyStyle, "id" | "name" | "css" | "prompt" | "updatedAt">[];
  rules: SiteRule[];
}

export function createBackup(styles: MyStyle[], rules: SiteRule[], now = new Date()): Backup {
  const ids = new Set(styles.map((s) => s.id));
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    // History and conversation stay local: they can be large and may contain private instructions.
    styles: styles.map(({ id, name, css, prompt, updatedAt }) => ({ id, name, css, prompt, updatedAt })),
    rules: rules.filter((rule) => ids.has(rule.styleId)),
  };
}

export interface ParsedBackup {
  styles: MyStyle[];
  rules: SiteRule[];
  warnings: string[];
}

/** Validate an untrusted backup file. Throws with a readable message if it isn't one. */
export function parseBackup(text: string): ParsedBackup {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  if (data?.format !== BACKUP_FORMAT || !Array.isArray(data.styles)) {
    throw new Error("This file isn't a PageCraft theme export.");
  }
  if (data.version !== 1) throw new Error(`Unsupported export version: ${String(data.version)}.`);

  const warnings: string[] = [];
  const styles: MyStyle[] = [];
  for (const raw of data.styles.slice(0, MAX_STYLES)) {
    if (!raw || typeof raw.id !== "string" || typeof raw.css !== "string") continue;
    const name = String(raw.name ?? "Imported style").slice(0, 60).trim() || "Imported style";
    if (raw.css.length > MAX_CSS_LENGTH) {
      warnings.push(`Skipped "${name}": its CSS is too large.`);
      continue;
    }
    const { css, warnings: cssWarnings } = sanitizeCss(raw.css);
    if (cssWarnings.length) warnings.push(`"${name}": ${cssWarnings.join(" ")}`);
    if (!css.trim()) continue;
    styles.push({
      id: raw.id.slice(0, 64),
      name,
      css,
      prompt: typeof raw.prompt === "string" ? raw.prompt.slice(0, 500) : undefined,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    });
  }
  if (data.styles.length > MAX_STYLES) warnings.push(`Only the first ${MAX_STYLES} styles were read.`);

  const ids = new Set(styles.map((s) => s.id));
  const rules: SiteRule[] = [];
  for (const raw of Array.isArray(data.rules) ? data.rules : []) {
    const pattern = typeof raw?.pattern === "string" ? normalizePattern(raw.pattern) : null;
    if (!pattern || !ids.has(raw.styleId)) continue;
    rules.push({ id: String(raw.id ?? crypto.randomUUID()).slice(0, 64), styleId: raw.styleId, pattern, enabled: raw.enabled !== false });
  }
  return { styles, rules, warnings };
}

export interface MergeResult {
  styles: MyStyle[];
  rules: SiteRule[];
  added: number;
  updated: number;
}

/**
 * Merge imported styles into the current ones. A style with the same id and name is updated;
 * a clashing id with a different name gets a new id. Imported rules replace current rules for
 * the same pattern.
 */
export function mergeBackup(
  current: { styles: MyStyle[]; rules: SiteRule[] },
  imported: ParsedBackup,
  newId: () => string = () => crypto.randomUUID(),
): MergeResult {
  const styles = [...current.styles];
  const idMap = new Map<string, string>();
  let added = 0;
  let updated = 0;
  for (const style of imported.styles) {
    const index = styles.findIndex((s) => s.id === style.id);
    if (index >= 0 && styles[index]!.name === style.name) {
      styles[index] = { ...styles[index]!, css: style.css, prompt: style.prompt, updatedAt: style.updatedAt };
      idMap.set(style.id, style.id);
      updated++;
    } else {
      const id = index >= 0 ? newId() : style.id;
      styles.push({ ...style, id });
      idMap.set(style.id, id);
      added++;
    }
  }
  const importedRules = imported.rules.map((rule) => ({ ...rule, id: newId(), styleId: idMap.get(rule.styleId)! }));
  const patterns = new Set(importedRules.map((rule) => normalizePattern(rule.pattern)));
  const rules = [...current.rules.filter((rule) => !patterns.has(normalizePattern(rule.pattern))), ...importedRules];
  return { styles, rules, added, updated };
}
