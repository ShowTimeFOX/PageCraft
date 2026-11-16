/**
 * Site rules: which style applies where.
 *
 * Pattern syntax (deliberately small):
 *   *                      every site (a global theme)
 *   example.com            that host only
 *   *.example.com          the host and all its subdomains
 *   example.com/docs/*     that host, paths starting with /docs/
 *   *.example.com/blog     subdomains too, path prefix /blog
 *
 * When several rules match, the most specific one wins, so a site rule overrides a global theme.
 */

export interface SiteRule {
  id: string;
  styleId: string;
  pattern: string;
  enabled: boolean;
}

interface ParsedPattern {
  global: boolean;
  host: string;
  subdomains: boolean;
  path: string;
}

const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

export function parsePattern(input: string): ParsedPattern | null {
  const value = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "");
  if (value === "*" || value === "*/*") return { global: true, host: "", subdomains: true, path: "/" };
  const slash = value.indexOf("/");
  let host = slash < 0 ? value : value.slice(0, slash);
  let path = slash < 0 ? "/" : value.slice(slash);
  const subdomains = host.startsWith("*.");
  if (subdomains) host = host.slice(2);
  host = host.replace(/:\d+$/, "");
  if (!HOST.test(host)) return null;
  path = path.replace(/\*+$/, "");
  if (!path.startsWith("/") || /[\s*?#]/.test(path)) return null;
  return { global: false, host, subdomains, path };
}

export function isValidPattern(input: string): boolean {
  return parsePattern(input) !== null;
}

/** Normalised form for display and de-duplication. */
export function normalizePattern(input: string): string | null {
  const parsed = parsePattern(input);
  if (!parsed) return null;
  if (parsed.global) return "*";
  const host = `${parsed.subdomains ? "*." : ""}${parsed.host}`;
  return parsed.path === "/" ? host : `${host}${parsed.path}${parsed.path.endsWith("/") ? "*" : ""}`;
}

/** Higher = more specific. Global < wildcard host < exact host; longer paths beat shorter ones. */
export function specificity(input: string): number {
  const parsed = parsePattern(input);
  if (!parsed) return -1;
  if (parsed.global) return 0;
  return (parsed.subdomains ? 1_000 : 2_000) + parsed.host.length + parsed.path.length * 10;
}

export function matchesPattern(input: string, hostname: string, pathname = "/"): boolean {
  const parsed = parsePattern(input);
  if (!parsed) return false;
  if (parsed.global) return true;
  const host = hostname.toLowerCase();
  const hostOk = host === parsed.host || (parsed.subdomains && host.endsWith(`.${parsed.host}`));
  return hostOk && pathname.startsWith(parsed.path);
}

/** The rule that applies to a URL, or undefined. */
export function findRule(rules: SiteRule[], hostname: string, pathname = "/"): SiteRule | undefined {
  let best: SiteRule | undefined;
  let bestScore = -1;
  for (const rule of rules) {
    if (!rule.enabled || !matchesPattern(rule.pattern, hostname, pathname)) continue;
    const score = specificity(rule.pattern);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

/** Set (or clear, with styleId "") the exact-host rule for a hostname, keeping other rules. */
export function setHostRule(rules: SiteRule[], hostname: string, styleId: string, newId: () => string): SiteRule[] {
  const host = hostname.toLowerCase();
  const others = rules.filter((rule) => normalizePattern(rule.pattern) !== host);
  if (!styleId) return others;
  const existing = rules.find((rule) => normalizePattern(rule.pattern) === host);
  return [...others, { id: existing?.id ?? newId(), styleId, pattern: host, enabled: true }];
}

/** Rules from the 1.x `selectedMyStyles` map (hostname → style id). */
export function rulesFromLegacy(selected: Record<string, string>, newId: () => string): SiteRule[] {
  return Object.entries(selected)
    .filter(([host, styleId]) => styleId && isValidPattern(host))
    .map(([host, styleId]) => ({ id: newId(), styleId, pattern: host.toLowerCase(), enabled: true }));
}
