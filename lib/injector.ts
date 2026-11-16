/**
 * Owns PageCraft's <style> element in a page (content script).
 *
 * - Keeps the element last in <head> so it wins cascade ties, and re-adds it when a
 *   single-page app's head manager removes or reorders tags.
 * - Optionally mirrors the CSS into open shadow roots so web components get themed too.
 *
 * Why not @layer or adoptedStyleSheets: unlayered site CSS beats any @layer for normal
 * declarations, and adoptedStyleSheets created from a content script are unreliable across
 * browsers (Firefox Xray wrappers). A plain last-in-head <style> is the strongest portable option.
 */

export const STYLE_ID = "pagecraft-custom-style";
const SHADOW_ATTR = "data-pagecraft";

export class StyleInjector {
  private css = "";
  private shadowEnabled = false;
  private readonly shadowStyles = new Map<ShadowRoot, HTMLStyleElement>();
  private headObserver: MutationObserver | null = null;
  private observedHead: HTMLHeadElement | null = null;
  private shadowObserver: MutationObserver | null = null;
  private keepTimer: number | undefined;
  private scanTimer: number | undefined;

  constructor(private readonly doc: Document = document) {}

  get styleElement(): HTMLStyleElement | null {
    return this.doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  }

  setCss(css: string) {
    this.css = css;
    if (!css) {
      this.styleElement?.remove();
      this.stopObservers();
      this.clearShadowStyles();
      return;
    }
    let style = this.styleElement;
    if (!style) {
      style = this.doc.createElement("style");
      style.id = STYLE_ID;
    }
    if (style.textContent !== css) style.textContent = css;
    this.place(style);
    this.startHeadObserver();
    if (this.shadowEnabled) this.syncShadowRoots();
  }

  setShadowRoots(enabled: boolean) {
    if (enabled === this.shadowEnabled) return;
    this.shadowEnabled = enabled;
    if (enabled && this.css) this.syncShadowRoots();
    if (!enabled) this.clearShadowStyles();
  }

  /** Call when <head> appears (it may not exist yet at document_start). */
  ensurePlaced() {
    const style = this.styleElement;
    if (style && this.css) this.place(style);
  }

  private place(style: HTMLStyleElement) {
    const parent = this.doc.head || this.doc.documentElement;
    if (!parent) return;
    if (style.parentNode !== parent || style !== parent.lastElementChild) parent.append(style);
  }

  private startHeadObserver() {
    if (this.headObserver || !this.doc.documentElement) return;
    this.headObserver = new MutationObserver(() => {
      this.observeHead();
      // Debounced: re-placing our element triggers another mutation, which then finds it last.
      window.clearTimeout(this.keepTimer);
      this.keepTimer = window.setTimeout(() => {
        if (!this.css) return;
        const style = this.styleElement;
        if (!style || !style.isConnected) this.setCss(this.css);
        else this.place(style);
      }, 50);
    });
    this.headObserver.observe(this.doc.documentElement, { childList: true });
    this.observeHead();
  }

  /** <head> can be created (or replaced) after we start observing. */
  private observeHead() {
    const head = this.doc.head;
    if (head && head !== this.observedHead && this.headObserver) {
      this.headObserver.observe(head, { childList: true });
      this.observedHead = head;
    }
  }

  private stopObservers() {
    this.headObserver?.disconnect();
    this.headObserver = null;
    this.observedHead = null;
    this.shadowObserver?.disconnect();
    this.shadowObserver = null;
  }

  // ------------------------------------------------------------ shadow roots

  private syncShadowRoots() {
    for (const root of this.findShadowRoots()) {
      let style = this.shadowStyles.get(root);
      if (!style || !style.isConnected) {
        style = this.doc.createElement("style");
        style.setAttribute(SHADOW_ATTR, "");
        root.append(style);
        this.shadowStyles.set(root, style);
        this.observeForShadowRoots(root);
      }
      if (style.textContent !== this.css) style.textContent = this.css;
    }
    this.observeForShadowRoots(this.doc.documentElement);
  }

  private findShadowRoots(): ShadowRoot[] {
    const found: ShadowRoot[] = [];
    const visit = (root: Document | ShadowRoot | Element) => {
      const walker = this.doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const shadow = (node as Element).shadowRoot;
        if (shadow) {
          found.push(shadow);
          visit(shadow);
        }
      }
    };
    if (this.doc.documentElement) visit(this.doc.documentElement);
    return found;
  }

  private observeForShadowRoots(target: Node | null) {
    if (!target) return;
    this.shadowObserver ??= new MutationObserver(() => {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = window.setTimeout(() => {
        if (this.shadowEnabled && this.css) this.syncShadowRoots();
      }, 400);
    });
    this.shadowObserver.observe(target, { childList: true, subtree: true });
  }

  private clearShadowStyles() {
    for (const style of this.shadowStyles.values()) style.remove();
    this.shadowStyles.clear();
    this.shadowObserver?.disconnect();
    this.shadowObserver = null;
  }
}
