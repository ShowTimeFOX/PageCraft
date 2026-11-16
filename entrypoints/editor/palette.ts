/** Palette panel: edit design tokens without an AI call. */
import { COLOR_KEYS, COLOR_LABELS, defaultTokens, normalizeTokens, type ColorKey, type ThemeTokens } from "@/lib/tokens";
import { blend, contrastRatio, parseColor, type Rgba } from "@/lib/contrast";

/** Token pairs whose contrast matters, with the WCAG AA minimum for each. */
const CONTRAST_PAIRS: { fg: ColorKey; bg: ColorKey; min: number; label: string }[] = [
  { fg: "text", bg: "background", min: 4.5, label: "Text on page" },
  { fg: "text", bg: "surface", min: 4.5, label: "Text on surfaces" },
  { fg: "text", bg: "surfaceRaised", min: 4.5, label: "Text on raised surfaces" },
  { fg: "textMuted", bg: "background", min: 4.5, label: "Muted text on page" },
  { fg: "textMuted", bg: "surface", min: 4.5, label: "Muted text on surfaces" },
  { fg: "link", bg: "background", min: 4.5, label: "Links on page" },
  { fg: "onAccent", bg: "accent", min: 4.5, label: "Text on accent" },
  { fg: "text", bg: "codeBackground", min: 4.5, label: "Code text" },
  { fg: "border", bg: "background", min: 1.5, label: "Borders (visible)" },
];

let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS color → RGBA (canvas fallback for hsl, oklch, named colors…). */
function resolve(value: string): Rgba | null {
  const parsed = parseColor(value);
  if (parsed) return parsed;
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "rgba(0, 0, 0, 0)";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = probe.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : [r, g, b, a / 255];
}

/** Contrast of each important token pair (null when a color can't be resolved). */
export function tokenContrast(tokens: ThemeTokens) {
  return CONTRAST_PAIRS.map((pair) => {
    const bg = resolve(tokens.colors[pair.bg]);
    const fg = resolve(tokens.colors[pair.fg]);
    if (!bg || !fg) return { ...pair, ratio: null };
    const solidBg = blend(bg, [255, 255, 255, 1]);
    return { ...pair, ratio: contrastRatio(blend(fg, solidBg), solidBg) };
  });
}

interface PaletteCallbacks {
  /** Called with validated tokens on every edit. `first` is true for the first edit after focusing the panel. */
  onChange(tokens: ThemeTokens, first: boolean): void;
  /** Called when the user creates a palette for a style that has none. */
  onCreate(tokens: ThemeTokens): void;
}

const toHex = (value: string): string => {
  const rgba = resolve(value);
  if (!rgba) return "#000000";
  return `#${rgba.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
};

export class PalettePanel {
  private tokens: ThemeTokens | null = null;
  private editedSinceFocus = false;
  private contrastList: HTMLUListElement | null = null;

  constructor(
    private readonly panel: HTMLElement,
    private readonly callbacks: PaletteCallbacks,
  ) {
    panel.addEventListener("focusin", () => (this.editedSinceFocus = false));
    panel.addEventListener("input", (event) => this.handleInput(event));
    panel.addEventListener("change", (event) => this.handleInput(event));
  }

  /** True while the user is typing in the panel (don't re-render under their cursor). */
  get isEditing(): boolean {
    return this.panel.contains(document.activeElement);
  }

  render(tokens: ThemeTokens | null) {
    this.tokens = tokens;
    this.panel.replaceChildren();
    if (!tokens) {
      this.renderEmpty();
      return;
    }

    const heading = (text: string) => {
      const h = document.createElement("h2");
      h.textContent = text;
      return h;
    };

    this.panel.append(
      heading("Theme"),
      this.field("Name", this.input("name", tokens.name, "text")),
      this.field("Scheme", this.select("scheme", tokens.scheme, [["dark", "Dark"], ["light", "Light"]])),
      heading("Colors"),
      ...COLOR_KEYS.map((key) => this.colorField(key, tokens.colors[key])),
      heading("Contrast (WCAG AA)"),
      this.renderContrast(tokens),
      heading("Typography"),
      this.field("Body font", this.input("font.body", tokens.font.body, "text", "inherit")),
      this.field("Code font", this.input("font.mono", tokens.font.mono, "text", "inherit")),
      this.grid(
        this.field("Base size", this.input("font.size", tokens.font.size, "text", "inherit")),
        this.field("Line height", this.input("font.lineHeight", tokens.font.lineHeight, "text", "inherit")),
      ),
      heading("Shape"),
      this.grid(
        this.field("Radius", this.input("shape.radius", tokens.shape.radius, "text")),
        this.field("Border width", this.input("shape.borderWidth", tokens.shape.borderWidth, "text")),
      ),
    );
    const note = document.createElement("p");
    note.textContent = "Changes rewrite only the token block at the top of the CSS. Invalid values fall back to defaults.";
    this.panel.append(note);
  }

  private renderEmpty() {
    const text = document.createElement("p");
    text.textContent =
      "This style has no palette yet. Generate a theme with AI, or start a palette here and reference it in your CSS with var(--pc-background), var(--pc-text) and so on.";
    const dark = document.createElement("button");
    dark.type = "button";
    dark.textContent = "Start a dark palette";
    dark.addEventListener("click", () => this.callbacks.onCreate(defaultTokens("dark")));
    const light = document.createElement("button");
    light.type = "button";
    light.className = "secondary";
    light.textContent = "Start a light palette";
    light.addEventListener("click", () => this.callbacks.onCreate(defaultTokens("light")));
    this.panel.append(text, dark, light);
  }

  private handleInput(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const path = target.dataset.token;
    if (!path || !this.tokens) return;

    // A color row has a picker and a text field; keep them in sync.
    if (target.dataset.pair) {
      const partner = this.panel.querySelector<HTMLInputElement>(`[data-token="${path}"][data-pair="${target.dataset.pair === "picker" ? "text" : "picker"}"]`);
      if (partner) partner.value = target.dataset.pair === "picker" ? target.value : toHex(target.value);
    }

    const next = structuredClone(this.tokens) as unknown as Record<string, any>;
    const [group, key] = path.split(".") as [string, string | undefined];
    if (key) next[group][key] = target.value;
    else next[group] = target.value;
    this.tokens = normalizeTokens(next);
    this.renderContrast(this.tokens);
    const first = !this.editedSinceFocus;
    this.editedSinceFocus = true;
    this.callbacks.onChange(this.tokens, first);
  }

  /** Build (or refresh in place) the list of token-pair contrast ratios. */
  private renderContrast(tokens: ThemeTokens): HTMLUListElement {
    const list = this.contrastList?.isConnected ? this.contrastList : document.createElement("ul");
    list.className = "palette-contrast";
    list.replaceChildren(
      ...tokenContrast(tokens).map(({ label, ratio, min }) => {
        const item = document.createElement("li");
        const ok = ratio !== null && ratio >= min;
        item.className = ratio === null ? "unknown" : ok ? "ok" : "bad";
        const name = document.createElement("span");
        name.textContent = label;
        const value = document.createElement("strong");
        value.textContent = ratio === null ? "?" : `${ok ? "✓" : "✗"} ${ratio.toFixed(1)}:1`;
        value.title = `Needs at least ${min}:1`;
        item.append(name, value);
        return item;
      }),
    );
    this.contrastList = list;
    return list;
  }

  private field(label: string, control: HTMLElement) {
    const wrap = document.createElement("div");
    wrap.className = "palette-field";
    const id = `palette-${Math.random().toString(36).slice(2, 8)}`;
    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.htmlFor = id;
    const focusable = control.matches("input, select") ? control : control.querySelector<HTMLElement>("input[type=text]");
    if (focusable) focusable.id = id;
    wrap.append(labelEl, control);
    return wrap;
  }

  private grid(...children: HTMLElement[]) {
    const grid = document.createElement("div");
    grid.className = "palette-grid";
    grid.append(...children);
    return grid;
  }

  private input(token: string, value: string, type: string, placeholderText = "") {
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.placeholder = placeholderText;
    input.spellcheck = false;
    input.dataset.token = token;
    return input;
  }

  private select(token: string, value: string, options: [string, string][]) {
    const select = document.createElement("select");
    for (const [optionValue, label] of options) select.add(new Option(label, optionValue));
    select.value = value;
    select.dataset.token = token;
    return select;
  }

  private colorField(key: ColorKey, value: string) {
    const row = document.createElement("div");
    row.className = "color-row";
    const picker = this.input(`colors.${key}`, toHex(value), "color");
    picker.dataset.pair = "picker";
    picker.title = `Pick ${COLOR_LABELS[key].toLowerCase()}`;
    const text = this.input(`colors.${key}`, value, "text");
    text.dataset.pair = "text";
    row.append(picker, text);
    return this.field(COLOR_LABELS[key], row);
  }
}
