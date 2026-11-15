import type { PageDigest } from "./messages";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "SVG", "PATH", "IFRAME", "BR", "WBR"]);
const KEEP_ATTRS = ["role", "aria-label", "type", "name"];
const MAX_OUTLINE_LINES = 220;
const MAX_DEPTH = 9;

/** Heuristic for build-generated class names that make brittle selectors. */
function isHashedClass(name: string): boolean {
  return (
    /^(?:css|sc|jsx|emotion|svelte|astro)-[\w-]{4,}$/i.test(name) ||
    /^_?[a-z0-9]{5,}$/i.test(name) && /\d/.test(name) && /[a-z]/i.test(name) ||
    /__[a-z0-9]{5,}$/i.test(name)
  );
}

function describe(el: Element): string {
  let label = el.tagName.toLowerCase();
  if (el.id && !isHashedClass(el.id)) label += `#${el.id}`;
  const classes = Array.from(el.classList).filter((c) => !isHashedClass(c)).slice(0, 4);
  if (classes.length) label += `.${classes.join(".")}`;
  const attrs = KEEP_ATTRS.flatMap((name) => {
    const value = el.getAttribute(name);
    return value ? [`${name}="${value.slice(0, 30)}"`] : [];
  });
  const dataAttrs = Array.from(el.attributes)
    .filter((a) => a.name.startsWith("data-") && a.value.length < 30)
    .slice(0, 2)
    .map((a) => `${a.name}="${a.value}"`);
  const all = [...attrs, ...dataAttrs];
  if (all.length) label += ` [${all.join(" ")}]`;
  return label;
}

function buildOutline(root: Element): string {
  const lines: string[] = [];
  const walk = (el: Element, depth: number) => {
    if (lines.length >= MAX_OUTLINE_LINES || depth > MAX_DEPTH) return;
    const children = Array.from(el.children).filter((c) => !SKIP_TAGS.has(c.tagName.toUpperCase()));
    let i = 0;
    while (i < children.length && lines.length < MAX_OUTLINE_LINES) {
      const child = children[i]!;
      const label = describe(child);
      let run = 1;
      while (i + run < children.length && describe(children[i + run]!) === label) run++;
      lines.push(`${"  ".repeat(depth)}${label}${run > 1 ? ` ×${run}` : ""}`);
      walk(child, depth + 1);
      i += run;
    }
  };
  walk(root, 0);
  if (lines.length >= MAX_OUTLINE_LINES) lines.push("… (truncated)");
  return lines.join("\n");
}

function topValues(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v]) => v);
}

function collectCustomProperties(ownStyleId: string): string[] {
  const props = new Map<string, string>();
  for (const sheet of Array.from(document.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.id === ownStyleId) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules; // throws for cross-origin sheets
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !/^(?::root|html|body)\b/.test(rule.selectorText)) continue;
      for (const name of Array.from(rule.style)) {
        if (name.startsWith("--") && !props.has(name)) {
          props.set(name, rule.style.getPropertyValue(name).trim().slice(0, 60));
        }
      }
    }
  }
  // Also pick up variables from cross-origin sheets via computed style.
  const computed = getComputedStyle(document.documentElement);
  for (const name of Array.from(computed)) {
    if (name.startsWith("--") && !props.has(name)) {
      props.set(name, computed.getPropertyValue(name).trim().slice(0, 60));
    }
  }
  return [...props.entries()].slice(0, 80).map(([k, v]) => `${k}: ${v}`);
}

/** Describe the page as the site styles it, with PageCraft's own sheet switched off while measuring. */
export function buildPageDigest(ownStyleId: string): PageDigest {
  const own = (document.getElementById(ownStyleId) as HTMLStyleElement | null)?.sheet;
  const wasDisabled = own?.disabled ?? false;
  if (own) own.disabled = true;
  try {
    return measure(ownStyleId);
  } finally {
    if (own) own.disabled = wasDisabled;
  }
}

function measure(ownStyleId: string): PageDigest {
  const backgrounds = new Map<string, number>();
  const textColors = new Map<string, number>();
  const fonts = new Map<string, number>();
  const elements = Array.from(document.body?.querySelectorAll("*") ?? []).slice(0, 2000);
  for (const el of elements) {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
    const style = getComputedStyle(el);
    const bg = style.backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) backgrounds.set(bg, (backgrounds.get(bg) ?? 0) + 1);
    if (el.childNodes.length && Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) {
      textColors.set(style.color, (textColors.get(style.color) ?? 0) + 1);
      fonts.set(style.fontFamily, (fonts.get(style.fontFamily) ?? 0) + 1);
    }
  }
  const rootStyle = document.body ? getComputedStyle(document.body) : null;
  if (rootStyle) backgrounds.set(`body: ${rootStyle.backgroundColor}`, Number.MAX_SAFE_INTEGER);

  return {
    url: location.origin + location.pathname,
    title: document.title.slice(0, 120),
    lang: document.documentElement.lang,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    customProperties: collectCustomProperties(ownStyleId),
    backgrounds: topValues(backgrounds, 8),
    textColors: topValues(textColors, 6),
    fonts: topValues(fonts, 3),
    outline: document.body ? buildOutline(document.body) : "",
  };
}
