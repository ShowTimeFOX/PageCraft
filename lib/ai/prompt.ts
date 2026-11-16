import { formatContrastReport, type ContrastReport } from "../contrast";
import type { PageDigest } from "../messages";
import type { ConversationTurn } from "../storage";
import { COLOR_KEYS, normalizeTokens, TOKEN_VARIABLES, type ThemeTokens } from "../tokens";
import { parseFences, pickBlock } from "./fences";
import type { ChatMessage, ContentPart } from "./providers";

const TOKEN_SCHEMA = `{
  "name": "short theme name",
  "scheme": "dark" | "light",
  "colors": { ${COLOR_KEYS.map((k) => `"${k}": "<css color>"`).join(", ")} },
  "font": { "body": "font stack or inherit", "mono": "font stack or inherit", "size": "e.g. 16px or inherit", "lineHeight": "e.g. 1.6 or inherit" },
  "shape": { "radius": "e.g. 8px", "borderWidth": "e.g. 1px" }
}`;

export const THEME_SYSTEM_PROMPT = `You are PageCraft, an expert at designing user-stylesheet themes for existing websites.

You receive a digest of a live web page (structure, existing CSS custom properties, dominant colors, fonts), sometimes a screenshot, a contrast report, the user's current theme, and the user's instructions.

Respond in exactly this format and order:
1. A \`\`\`json block with the theme's design tokens:
${TOKEN_SCHEMA}
2. A \`\`\`css block with the rules that apply the tokens to this site. Reference tokens only through these variables: ${TOKEN_VARIABLES.join(", ")}. PageCraft defines the --pc-* variables itself from your JSON, so never declare them.
3. One short plain sentence (outside the code blocks) saying what you designed or changed.

Design rules:
- Decide the palette first: choose token colors that meet WCAG AA contrast (4.5:1 text on background/surface, 3:1 for large text and UI borders), then map them.
- If the site defines its own CSS custom properties, override those (on :root or wherever they are defined) with var(--pc-*) values first; it is the most robust way to theme a site. Then cover elements the variables miss.
- Prefer stable selectors: element names, ids, [role], [aria-*], [data-*] attributes and semantic class names. Avoid hashed or generated class names (e.g. "css-1x2y3z", "sc-abc123", "_a1b2c3").
- Use !important where needed to beat site styles, but not on every declaration.
- Never hide, remove or move content unless asked. Don't change layout unless asked.
- Make it complete: links, buttons, inputs and other form controls, :hover and :focus-visible states, tables, code blocks, ::selection, scrollbars, borders and dividers.
- Use "inherit" for font tokens unless the user asks for different fonts. Only use fonts that are commonly installed (system-ui, Segoe UI, Roboto, Helvetica, Georgia, ui-monospace, Consolas…).
- No @import, no url(...) to anything except data: URLs, no web fonts from servers.
- When a current theme is provided, return the full updated tokens and the full updated CSS (not a diff), keeping what the user didn't ask to change.`;

export const REVIEW_INSTRUCTION = `Review the current theme as it looks on the page and fix its problems: text that fails contrast (see the contrast report), elements the theme missed (still showing the site's original colors), clashing or inconsistent colors, unreadable states (hover, focus, disabled, selection) and broken-looking controls. Keep the overall design and palette intent. Return the full corrected tokens and CSS.`;

export interface ThemeImage {
  mediaType: "image/jpeg" | "image/png";
  data: string;
}

export interface ThemeRequest {
  hostname: string;
  instructions: string;
  digest?: PageDigest | null;
  /** Current tokens and the CSS without its token block. */
  currentTokens?: ThemeTokens | null;
  currentCss?: string;
  /** Earlier turns for this style, oldest first. */
  history?: ConversationTurn[];
  screenshot?: ThemeImage | null;
  contrast?: ContrastReport | null;
}

export const MAX_HISTORY_TURNS = 6;

function formatDigest(d: PageDigest): string {
  const lines = [
    `URL: ${d.url}`,
    `Title: ${d.title}`,
    d.lang && `Language: ${d.lang}`,
    d.colorScheme && `Declared color-scheme: ${d.colorScheme}`,
    d.backgrounds.length && `Dominant background colors: ${d.backgrounds.join(", ")}`,
    d.textColors.length && `Dominant text colors: ${d.textColors.join(", ")}`,
    d.fonts.length && `Fonts: ${d.fonts.join(" | ")}`,
    d.customProperties.length && `CSS custom properties on :root:\n${d.customProperties.join("\n")}`,
    `DOM outline (tag#id.class [attributes], repeated siblings collapsed):\n${d.outline}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildThemeMessages(req: ThemeRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // Earlier turns as alternating user/assistant messages (summaries, not full CSS, to save tokens).
  for (const turn of (req.history ?? []).slice(-MAX_HISTORY_TURNS)) {
    messages.push({ role: "user", content: turn.instruction });
    messages.push({ role: "assistant", content: turn.summary || "Updated the theme." });
  }

  const parts = [`Website: ${req.hostname}`];
  parts.push(req.digest ? `Page digest:\n${formatDigest(req.digest)}` : "Page digest: unavailable (write generic, robust CSS).");
  if (req.contrast) parts.push(formatContrastReport(req.contrast));
  if (req.currentTokens) parts.push(`Current tokens:\n\`\`\`json\n${JSON.stringify(req.currentTokens, null, 2)}\n\`\`\``);
  if (req.currentCss?.trim()) parts.push(`Current CSS (update it):\n\`\`\`css\n${req.currentCss.trim()}\n\`\`\``);
  if (req.screenshot) parts.push("The attached screenshot shows the visible part of the page with the current theme applied (if any).");
  parts.push(`Instructions:\n${req.instructions.trim()}`);

  const text = parts.join("\n\n");
  const content: ChatMessage["content"] = req.screenshot
    ? ([{ type: "image", mediaType: req.screenshot.mediaType, data: req.screenshot.data }, { type: "text", text }] satisfies ContentPart[])
    : text;
  messages.push({ role: "user", content });
  return messages;
}

export interface ThemeResponse {
  /** Validated tokens once the JSON block is complete; null if missing or invalid. */
  tokens: ThemeTokens | null;
  /** Raw CSS from the css block (not yet sanitized). */
  css: string;
  /** The model's one-sentence summary. */
  summary: string;
}

/** Parse a (possibly still streaming) model response. */
export function parseThemeResponse(text: string): ThemeResponse {
  const { blocks, prose } = parseFences(text);
  let tokens: ThemeTokens | null = null;
  const json = pickBlock(blocks, ["json"]);
  if (json?.closed) {
    try {
      tokens = normalizeTokens(JSON.parse(json.body));
    } catch {
      tokens = null;
    }
  }
  const cssBlock = pickBlock(blocks, ["css", ""]);
  const css = cssBlock ? cssBlock.body : blocks.length ? "" : text;
  return { tokens, css: css.trim() ? css.trimEnd() + "\n" : "", summary: prose.slice(0, 300) };
}
