/** Split a model response into fenced code blocks and the prose around them. */

export interface FencedBlock {
  lang: string;
  body: string;
  /** False while the closing ``` hasn't arrived yet (streaming). */
  closed: boolean;
}

export interface ParsedResponse {
  blocks: FencedBlock[];
  /** Text outside code blocks, trimmed and whitespace-collapsed. */
  prose: string;
}

export function parseFences(text: string): ParsedResponse {
  const blocks: FencedBlock[] = [];
  const prose: string[] = [];
  let current: { lang: string; lines: string[] } | null = null;

  for (const line of text.split(/\r?\n/)) {
    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (current) {
      if (fence && fence[1] === "") {
        blocks.push({ lang: current.lang, body: current.lines.join("\n"), closed: true });
        current = null;
      } else {
        current.lines.push(line);
      }
    } else if (fence) {
      current = { lang: (fence[1] ?? "").toLowerCase(), lines: [] };
    } else {
      prose.push(line);
    }
  }
  if (current) blocks.push({ lang: current.lang, body: current.lines.join("\n"), closed: false });

  return { blocks, prose: prose.join(" ").replace(/\s+/g, " ").trim() };
}

/** The longest block in one of the given languages ("" = no language tag). */
export function pickBlock(blocks: FencedBlock[], langs: string[]): FencedBlock | undefined {
  return blocks
    .filter((block) => langs.includes(block.lang))
    .reduce<FencedBlock | undefined>((best, block) => (!best || block.body.length > best.body.length ? block : best), undefined);
}
