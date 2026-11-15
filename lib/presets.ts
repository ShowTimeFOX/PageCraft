import type { PresetId } from "./storage";

export const presets: Record<Exclude<PresetId, "none">, string> = {
  dark: `
    :root { color-scheme: dark !important; }
    html, body { background-color: #17191c !important; color: #e8eaed !important; }
    a { color: #8ab4f8 !important; }
    input, textarea, select, button { color-scheme: dark !important; }
  `,
  light: `
    :root { color-scheme: light !important; }
    html, body { background-color: #ffffff !important; color: #202124 !important; }
    a { color: #1558d6 !important; }
    input, textarea, select, button { color-scheme: light !important; }
  `,
};
