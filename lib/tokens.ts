/**
 * Design tokens: the palette, typography and shape of a theme.
 *
 * The model writes tokens as JSON; PageCraft validates them and writes the `:root { --pc-* }` block
 * itself. The block lives at the top of the style's CSS between markers, which makes the CSS the
 * single source of truth: the Palette panel reads tokens back from it and rewrites only that block.
 */

export const COLOR_KEYS = [
  "background",
  "surface",
  "surfaceRaised",
  "text",
  "textMuted",
  "border",
  "accent",
  "onAccent",
  "link",
  "selection",
  "codeBackground",
  "danger",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

export interface ThemeTokens {
  name: string;
  scheme: "dark" | "light";
  colors: Record<ColorKey, string>;
  font: { body: string; mono: string; size: string; lineHeight: string };
  shape: { radius: string; borderWidth: string };
}

export const COLOR_LABELS: Record<ColorKey, string> = {
  background: "Page background",
  surface: "Surfaces (cards, panels)",
  surfaceRaised: "Raised surfaces (menus, inputs)",
  text: "Text",
  textMuted: "Muted text",
  border: "Borders",
  accent: "Accent (buttons, highlights)",
  onAccent: "Text on accent",
  link: "Links",
  selection: "Text selection",
  codeBackground: "Code background",
  danger: "Errors / danger",
};

const DEFAULTS: Record<ThemeTokens["scheme"], ThemeTokens> = {
  dark: {
    name: "Untitled theme",
    scheme: "dark",
    colors: {
      background: "#16181c",
      surface: "#1e2126",
      surfaceRaised: "#272b31",
      text: "#e6e8eb",
      textMuted: "#a2a9b3",
      border: "#353a42",
      accent: "#8ab4f8",
      onAccent: "#0d1117",
      link: "#8ab4f8",
      selection: "#3b4a63",
      codeBackground: "#23272e",
      danger: "#f28b82",
    },
    font: { body: "inherit", mono: "inherit", size: "inherit", lineHeight: "inherit" },
    shape: { radius: "6px", borderWidth: "1px" },
  },
  light: {
    name: "Untitled theme",
    scheme: "light",
    colors: {
      background: "#ffffff",
      surface: "#f6f7f9",
      surfaceRaised: "#ffffff",
      text: "#1d1f23",
      textMuted: "#5f6670",
      border: "#d9dde3",
      accent: "#1458a6",
      onAccent: "#ffffff",
      link: "#1458a6",
      selection: "#cfe0fb",
      codeBackground: "#f1f3f5",
      danger: "#b3261e",
    },
    font: { body: "inherit", mono: "inherit", size: "inherit", lineHeight: "inherit" },
    shape: { radius: "6px", borderWidth: "1px" },
  },
};

export function defaultTokens(scheme: ThemeTokens["scheme"] = "dark"): ThemeTokens {
  return structuredClone(DEFAULTS[scheme]);
}

// Strict value grammars: token values end up inside CSS, so nothing that could open a block,
// end a declaration, or reference a resource gets through.
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-\d.%\s,/a-z]*\)|color\(\s*[a-z0-9-]+[-\d.%\s/]*\)|[a-z]{3,20})$/i;
const FONT = /^[\w\s,"'.-]{1,200}$/;
const SIZE = /^(?:inherit|\d+(?:\.\d+)?(?:px|rem|em|%))$/;
const LINE_HEIGHT = /^(?:inherit|normal|\d+(?:\.\d+)?(?:px|rem|em|%)?)$/;
const LENGTH = /^\d+(?:\.\d+)?(?:px|rem|em|%)?$/;

const pick = (value: unknown, grammar: RegExp, fallback: string): string => {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return grammar.test(text) && !/url|expression|\\/i.test(text) ? text : fallback;
};

/** Validate untrusted token JSON, filling gaps from the defaults for its scheme. */
export function normalizeTokens(raw: unknown): ThemeTokens {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const scheme: ThemeTokens["scheme"] = input.scheme === "light" ? "light" : "dark";
  const base = defaultTokens(scheme);
  const colors = { ...base.colors };
  for (const key of COLOR_KEYS) colors[key] = pick(input.colors?.[key], COLOR, base.colors[key]);
  return {
    name: typeof input.name === "string" ? input.name.replace(/\*\/|[<>{}\n\r]/g, "").trim().slice(0, 60) || base.name : base.name,
    scheme,
    colors,
    font: {
      body: pick(input.font?.body, FONT, base.font.body),
      mono: pick(input.font?.mono, FONT, base.font.mono),
      size: pick(input.font?.size, SIZE, base.font.size),
      lineHeight: pick(input.font?.lineHeight, LINE_HEIGHT, base.font.lineHeight),
    },
    shape: {
      radius: pick(input.shape?.radius, LENGTH, base.shape.radius),
      borderWidth: pick(input.shape?.borderWidth, LENGTH, base.shape.borderWidth),
    },
  };
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Every CSS variable the tokens define, for the prompt. */
export const TOKEN_VARIABLES = [
  ...COLOR_KEYS.map((key) => `--pc-${kebab(key)}`),
  "--pc-font-body",
  "--pc-font-mono",
  "--pc-font-size",
  "--pc-line-height",
  "--pc-radius",
  "--pc-border-width",
];

const START = "/* pagecraft:tokens:start";
const END = "/* pagecraft:tokens:end */";
const BLOCK = /\/\* pagecraft:tokens:start[\s\S]*?\/\* pagecraft:tokens:end \*\/\n*/;

export function tokensToCss(tokens: ThemeTokens): string {
  const lines = [
    `${START} · ${tokens.name} · edit in the Palette panel */`,
    ":root {",
    `  color-scheme: ${tokens.scheme} !important;`,
    ...COLOR_KEYS.map((key) => `  --pc-${kebab(key)}: ${tokens.colors[key]};`),
    `  --pc-font-body: ${tokens.font.body};`,
    `  --pc-font-mono: ${tokens.font.mono};`,
    `  --pc-font-size: ${tokens.font.size};`,
    `  --pc-line-height: ${tokens.font.lineHeight};`,
    `  --pc-radius: ${tokens.shape.radius};`,
    `  --pc-border-width: ${tokens.shape.borderWidth};`,
    "}",
    END,
  ];
  return lines.join("\n") + "\n";
}

/** Read tokens back from a stylesheet's token block, or null if it has none. */
export function tokensFromCss(css: string): ThemeTokens | null {
  const block = css.match(BLOCK)?.[0];
  if (!block) return null;
  const name = block.match(/pagecraft:tokens:start · (.*?) · edit/)?.[1];
  const scheme = block.match(/color-scheme:\s*(dark|light)/)?.[1];
  const read = (variable: string) => block.match(new RegExp(`${variable}:\\s*([^;]+);`))?.[1]?.trim();
  return normalizeTokens({
    name,
    scheme,
    colors: Object.fromEntries(COLOR_KEYS.map((key) => [key, read(`--pc-${kebab(key)}`)])),
    font: {
      body: read("--pc-font-body"),
      mono: read("--pc-font-mono"),
      size: read("--pc-font-size"),
      lineHeight: read("--pc-line-height"),
    },
    shape: { radius: read("--pc-radius"), borderWidth: read("--pc-border-width") },
  });
}

/** The stylesheet without its token block (what the model sees as "current CSS"). */
export function stripTokenBlock(css: string): string {
  return css.replace(BLOCK, "").trimStart();
}

/** Put a fresh token block at the top, replacing any existing one. */
export function withTokenBlock(css: string, tokens: ThemeTokens): string {
  return `${tokensToCss(tokens)}\n${stripTokenBlock(css)}`;
}

/** Remove --pc-* declarations from model CSS; only the token block may define them. */
export function stripTokenDeclarations(css: string): string {
  return css.replace(/--pc-[\w-]+\s*:[^;}]*;?/g, "");
}
