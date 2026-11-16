import { browser } from "wxt/browser";

/**
 * Host access. PageCraft requests no website access at install (optional_host_permissions):
 * the user enables single sites, or all sites, from the popup. Provider API hosts are requested
 * the first time they're contacted.
 *
 * `permissions.request` must run inside a user gesture: call the request functions
 * synchronously from a click/keydown handler, before any `await`.
 */
const ALL_SITES = { origins: ["<all_urls>"] };

/** Match pattern covering a URL's host (match patterns ignore ports). */
export function originPattern(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

/** Both schemes for a website host, so a theme keeps working if the site switches http/https. */
export function siteOrigins(hostname: string): string[] {
  return [`https://${hostname}/*`, `http://${hostname}/*`];
}

export function hasAllSitesAccess(): Promise<boolean> {
  return browser.permissions.contains(ALL_SITES);
}

export function requestAllSitesAccess(): Promise<boolean> {
  return browser.permissions.request(ALL_SITES);
}

export function hasSiteAccess(hostname: string): Promise<boolean> {
  return browser.permissions.contains({ origins: siteOrigins(hostname) });
}

export function requestSiteAccess(hostname: string): Promise<boolean> {
  return browser.permissions.request({ origins: siteOrigins(hostname) });
}

/** Stop applying themes on one site. Has no effect while "all sites" is granted. */
export function removeSiteAccess(hostname: string): Promise<boolean> {
  return browser.permissions.remove({ origins: siteOrigins(hostname) });
}

/** Granted website origins, for the settings page. */
export async function grantedSites(): Promise<{ all: boolean; hosts: string[] }> {
  const { origins = [] } = await browser.permissions.getAll();
  const hosts = new Set<string>();
  for (const origin of origins) {
    const host = origin.match(/^https?:\/\/([^/]+)\/\*$/)?.[1];
    if (host) hosts.add(host);
  }
  return { all: origins.includes("<all_urls>"), hosts: [...hosts].sort() };
}

/** Ask for access to a provider's API host. Resolves immediately when already granted. */
export function requestProviderAccess(baseUrl: string): Promise<boolean> {
  const pattern = originPattern(baseUrl);
  if (!pattern) return Promise.resolve(false);
  return browser.permissions.request({ origins: [pattern] }).catch(() => false);
}
