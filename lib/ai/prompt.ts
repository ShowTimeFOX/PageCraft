import type { PageDigest } from "../messages";
import type { ChatMessage } from "./providers";

export const THEME_SYSTEM_PROMPT = `You are PageCraft, an expert at writing user stylesheets that re-theme existing websites.

You receive a digest of a live web page (structure, existing CSS custom properties, dominant colors, fonts), optionally the user's current stylesheet, and the user's instructions. Write CSS that is injected into the page as a user stylesheet.

Rules:
- Output ONLY one \`\`\`css fenced code block containing the complete stylesheet. No explanations outside it.
- If the site defines CSS custom properties (variables), override those on :root (or the element that defines them) first; it is the most robust way to theme a site.
- Prefer stable selectors: element names, ids, [role], [aria-*], [data-*] attributes and semantic class names. Avoid hashed or generated class names (e.g. "css-1x2y3z", "sc-abc123", "_a1b2c3").
- Use !important where needed to beat site styles, but don't add it to every declaration needlessly.
- Never hide, remove or move content unless the user explicitly asks. Don't change layout unless asked.
- Keep text readable: aim for WCAG AA contrast (4.5:1 for body text) between text and background.
- Style interactive states (:hover, :focus-visible), form controls, code blocks, tables and scrollbars when they exist, so the theme feels complete.
- Do NOT use @import, external url(...) references, or web fonts from remote servers. data: URLs and locally installed fonts are fine.
- When a current stylesheet is provided, return the full updated stylesheet (not a diff), keeping parts the user didn't ask to change.
- Start the stylesheet with a short comment naming the theme.`;

export interface ThemeRequest {
  hostname: string;
  instructions: string;
  digest?: PageDigest | null;
  currentCss?: string;
}

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
  const parts = [`Website: ${req.hostname}`];
  parts.push(req.digest ? `Page digest:\n${formatDigest(req.digest)}` : "Page digest: unavailable (write generic, robust CSS).");
  if (req.currentCss?.trim()) {
    parts.push(`Current stylesheet (update it):\n\`\`\`css\n${req.currentCss.trim()}\n\`\`\``);
  }
  parts.push(`Instructions:\n${req.instructions.trim()}`);
  return [{ role: "user", content: parts.join("\n\n") }];
}
