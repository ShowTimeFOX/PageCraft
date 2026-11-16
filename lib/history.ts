import type { MyStyle, StyleVersion } from "./storage";

export const MAX_SAVED_VERSIONS = 20;

/**
 * Apply a save to a style, moving the previously saved CSS into its history
 * (newest first, capped, no consecutive duplicates).
 */
export function saveWithHistory(
  previous: MyStyle | undefined,
  next: Omit<MyStyle, "history">,
  max = MAX_SAVED_VERSIONS,
): MyStyle {
  const history = [...(previous?.history ?? [])];
  if (previous && previous.css.trim() && previous.css !== next.css && history[0]?.css !== previous.css) {
    history.unshift({ css: previous.css, prompt: previous.prompt, savedAt: previous.updatedAt ?? Date.now() });
  }
  return { ...previous, ...next, history: history.slice(0, max) };
}

export function describeVersion(version: StyleVersion, now = Date.now()): string {
  const minutes = Math.round((now - version.savedAt) / 60_000);
  const when =
    minutes < 1 ? "just now"
    : minutes < 60 ? `${minutes} min ago`
    : minutes < 60 * 24 ? `${Math.round(minutes / 60)} h ago`
    : new Date(version.savedAt).toLocaleDateString();
  const label = version.prompt ? version.prompt.slice(0, 50) : `${version.css.split("\n").length} lines`;
  return `${when} · ${label}`;
}
