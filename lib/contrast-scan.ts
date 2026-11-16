/** Measure text contrast on the live page (content script). */
import { blend, contrastRatio, parseColor, requiredRatio, toCss, type ContrastIssue, type ContrastReport, type Rgba } from "./contrast";
import { describeElement } from "./digest";

const MAX_ELEMENTS = 1500;
const MAX_ISSUES = 12;
/** Stop scanning after this long so huge pages stay responsive. */
const TIME_BUDGET_MS = 150;
const WHITE: Rgba = [255, 255, 255, 1];

let probe: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, Rgba | null>();

/** Any CSS color → RGBA. Computed styles can be oklch()/lab() etc., so fall back to the canvas. */
function toRgba(color: string): Rgba | null {
  const cached = cache.get(color);
  if (cached !== undefined) return cached;
  let result = parseColor(color);
  if (!result) {
    probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "rgba(0, 0, 0, 0)";
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = probe.getImageData(0, 0, 1, 1).data;
      result = [r, g, b, a / 255];
    }
  }
  cache.set(color, result);
  return result;
}

/**
 * Background behind an element: composite ancestor backgrounds from the root down.
 * Returns null when an image or gradient is involved (can't be measured reliably).
 */
function effectiveBackground(el: Element): Rgba | null {
  const layers: Rgba[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.backgroundImage && style.backgroundImage !== "none") return null;
    const bg = toRgba(style.backgroundColor);
    if (bg && bg[3] > 0) {
      layers.push(bg);
      if (bg[3] >= 1) break;
    }
  }
  return layers.reduceRight<Rgba>((under, layer) => blend(layer, under), WHITE);
}

function hasOwnText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim().length > 1) return true;
  }
  return false;
}

export function scanContrast(root: ParentNode = document.body ?? document, budgetMs = TIME_BUDGET_MS): ContrastReport {
  const groups = new Map<string, ContrastIssue>();
  const started = performance.now();
  let checked = 0;
  let failing = 0;
  let truncated = false;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node && checked < MAX_ELEMENTS; node = walker.nextNode()) {
    if ((checked & 31) === 0 && performance.now() - started > budgetMs) {
      truncated = true;
      break;
    }
    const el = node as Element;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|OPTION)$/i.test(el.tagName) || !hasOwnText(el)) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const background = effectiveBackground(el);
    const color = toRgba(style.color);
    if (!background || !color) continue;
    checked++;

    const foreground = blend(color, background);
    const ratio = contrastRatio(foreground, background);
    const required = requiredRatio(Number.parseFloat(style.fontSize), Number.parseInt(style.fontWeight, 10) || 400);
    if (ratio >= required) continue;

    failing++;
    const selector = describeElement(el);
    const key = `${selector}|${toCss(foreground)}|${toCss(background)}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { selector, color: toCss(foreground), background: toCss(background), ratio, required, count: 1 });
  }

  const issues = [...groups.values()]
    .sort((a, b) => a.ratio / a.required - b.ratio / b.required || b.count - a.count)
    .slice(0, MAX_ISSUES);
  return { checked, failing, issues, durationMs: Math.round(performance.now() - started), truncated };
}
