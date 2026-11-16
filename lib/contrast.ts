/** WCAG contrast math. Pure functions, shared by the content script and tests. */

export type Rgba = [r: number, g: number, b: number, a: number];

/** Parse `rgb()/rgba()` in comma or space syntax, and `color(srgb …)`. Returns null for anything else. */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), parseAlpha(rgb[4])];
  }
  const srgb = text.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (srgb) {
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, parseAlpha(srgb[4])];
  }
  const hex = text.match(/^#([0-9a-f]{3,8})$/)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  return null;
}

function parseAlpha(value: string | undefined): number {
  if (value === undefined) return 1;
  return value.endsWith("%") ? Number.parseFloat(value) / 100 : Number(value);
}

/** Composite `top` over an opaque `bottom`. */
export function blend(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

export function relativeLuminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA: 3:1 for large text (≥24px, or ≥18.66px bold), 4.5:1 otherwise. */
export function requiredRatio(fontSizePx: number, fontWeight: number): number {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
}

export function toCss([r, g, b, a]: Rgba): string {
  const round = (n: number) => Math.round(n);
  return a < 1 ? `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${Number(a.toFixed(2))})` : `rgb(${round(r)}, ${round(g)}, ${round(b)})`;
}

export interface ContrastIssue {
  /** Short element description (tag#id.class), never text content. */
  selector: string;
  color: string;
  background: string;
  ratio: number;
  required: number;
  count: number;
}

export interface ContrastReport {
  checked: number;
  failing: number;
  issues: ContrastIssue[];
  /** How long the scan took, so callers can back off on heavy pages. */
  durationMs?: number;
  /** True when the time budget ran out before every element was checked. */
  truncated?: boolean;
}

export function formatContrastReport(report: ContrastReport): string {
  if (!report.issues.length) return `Contrast check: all ${report.checked} text elements meet WCAG AA.`;
  const lines = report.issues.map(
    (i) => `- ${i.selector} ×${i.count}: ${i.color} on ${i.background} = ${i.ratio.toFixed(2)}:1 (needs ${i.required}:1)`,
  );
  return `Contrast check: ${report.failing} of ${report.checked} text elements fail WCAG AA.\n${lines.join("\n")}`;
}
