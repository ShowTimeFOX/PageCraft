/**
 * Lightweight textarea-based CSS editor: syntax highlighting, line numbers, active line,
 * bracket pairing, property/value completion and an inline color picker.
 *
 * Kept behind a small API (value / onChange / setReadOnly) so it can be swapped for CodeMirror 6.
 */

const cssProperties = [
  "align-items", "background", "background-color", "border", "border-color",
  "border-radius", "box-shadow", "color", "cursor", "display", "filter",
  "flex-direction", "font-family", "font-size", "font-weight", "gap", "height",
  "justify-content", "letter-spacing", "line-height", "margin", "max-height",
  "max-width", "min-height", "min-width", "opacity", "outline", "overflow", "padding",
  "position", "text-align", "text-decoration", "transform", "transition",
  "visibility", "white-space", "width", "z-index",
];

const cssValues: Record<string, string[]> = {
  "align-items": ["center", "flex-start", "flex-end", "stretch", "baseline"],
  background: ["transparent", "none", "cover", "contain", "center"],
  "background-color": ["transparent", "white", "black", "#ffffff", "#000000"],
  border: ["none", "0", "1px solid currentColor"],
  "border-color": ["transparent", "currentColor", "#000000", "#ffffff"],
  "border-radius": ["0", "4px", "8px", "50%"],
  "box-shadow": ["none", "0 1px 4px #0003"],
  color: ["currentColor", "inherit", "white", "black", "red", "blue", "transparent"],
  cursor: ["auto", "default", "pointer", "not-allowed", "text"],
  display: ["block", "flex", "grid", "inline", "inline-block", "none"],
  "flex-direction": ["row", "column", "row-reverse", "column-reverse"],
  "font-family": ["system-ui, sans-serif", "Arial, sans-serif", "monospace"],
  "font-size": ["12px", "14px", "16px", "1rem", "1.2em"],
  "font-weight": ["normal", "bold", "400", "500", "600", "700"],
  gap: ["0", "4px", "8px", "16px", "1rem"],
  height: ["auto", "100%", "100vh", "100dvh", "100px"],
  "justify-content": ["center", "space-between", "space-around", "flex-start", "flex-end"],
  margin: ["0", "auto", "8px", "16px"],
  opacity: ["0", "0.5", "1"],
  overflow: ["visible", "hidden", "auto", "scroll"],
  padding: ["0", "4px", "8px", "16px"],
  position: ["static", "relative", "absolute", "fixed", "sticky"],
  "text-align": ["left", "center", "right", "justify"],
  "text-decoration": ["none", "underline", "line-through"],
  visibility: ["visible", "hidden"],
  "white-space": ["normal", "nowrap", "pre", "pre-wrap"],
  width: ["auto", "100%", "100vw", "100px", "fit-content"],
  "z-index": ["0", "1", "10", "100", "999"],
};

const commonValues = ["auto", "none", "inherit", "initial", "unset", "revert", "0", "100%"];
const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };

interface Suggestion {
  label: string;
  insert: string;
  kind: "property" | "value";
}

export interface CssEditorElements {
  textarea: HTMLTextAreaElement;
  highlightedCode: HTMLElement;
  highlightLayer: HTMLElement;
  lineNumbers: HTMLElement;
  completionList: HTMLElement;
  colorPicker: HTMLInputElement;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function highlightLine(line: string, startsInComment: boolean): { html: string; inComment: boolean } {
  const tokenPattern = /\/\*.*?\*\/|\/\*.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@[a-z-]+|!important\b|#[\da-f]{3,8}\b|\b(?:\d+(?:\.\d+)?|\.\d+)(?:%|[a-z]+)?\b|[a-z_-][\w-]*/gi;
  let result = "";
  let position = 0;
  let inComment = startsInComment;

  if (inComment) {
    const commentEnd = line.indexOf("*/");
    if (commentEnd < 0) return { html: `<span class="token-comment">${escapeHtml(line)}</span>`, inComment: true };
    result += `<span class="token-comment">${escapeHtml(line.slice(0, commentEnd + 2))}</span>`;
    position = commentEnd + 2;
    inComment = false;
  }

  const remaining = line.slice(position);
  let cursor = 0;
  for (const match of remaining.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    const token = match[0];
    result += escapeHtml(remaining.slice(cursor, index));
    const absoluteEnd = position + index + token.length;
    let tokenClass = "";

    if (token.startsWith("/*")) {
      tokenClass = "token-comment";
      if (!token.endsWith("*/")) inComment = true;
    } else if (token.startsWith('"') || token.startsWith("'")) {
      tokenClass = "token-string";
    } else if (token.startsWith("@")) {
      tokenClass = "token-at";
    } else if (token.toLowerCase() === "!important") {
      tokenClass = "token-important";
    } else if (token.startsWith("#")) {
      tokenClass = "token-color";
    } else if (/^(?:\d|\.)/.test(token)) {
      tokenClass = "token-number";
    } else if (/^\s*:/.test(line.slice(absoluteEnd))) {
      tokenClass = "token-property";
    }

    const escaped = escapeHtml(token);
    result += tokenClass ? `<span class="${tokenClass}">${escaped}</span>` : escaped;
    cursor = index + token.length;
  }

  result += escapeHtml(remaining.slice(cursor));
  return { html: result, inComment };
}

function normalizeColor(value: string): string | null {
  const probe = document.createElement("span");
  probe.style.color = value;
  if (!probe.style.color) return null;
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const channels = resolved.match(/[\d.]+/g);
  if (!channels || channels.length < 3) return null;
  return `#${channels.slice(0, 3).map((ch) => Math.round(Number(ch)).toString(16).padStart(2, "0")).join("")}`;
}

export class CssEditor {
  private suggestions: Suggestion[] = [];
  private selectedSuggestion = 0;
  private colorRange: { start: number; end: number } | null = null;
  private isRendering = false;
  private changeListeners: ((value: string) => void)[] = [];
  private measureContext = document.createElement("canvas").getContext("2d");

  constructor(private readonly el: CssEditorElements) {
    const { textarea, colorPicker, completionList } = el;
    textarea.addEventListener("input", () => {
      this.render();
      this.emitChange();
    });
    for (const type of ["click", "keyup", "scroll"]) textarea.addEventListener(type, () => this.render());
    textarea.addEventListener("keydown", (event) => this.handleKeydown(event));
    textarea.addEventListener("blur", () => {
      completionList.hidden = true;
      window.setTimeout(() => {
        if (document.activeElement !== colorPicker) colorPicker.hidden = true;
      }, 0);
    });
    colorPicker.addEventListener("input", () => {
      if (!this.colorRange) return;
      textarea.setRangeText(colorPicker.value, this.colorRange.start, this.colorRange.end, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
    });
    this.render();
  }

  get value(): string {
    return this.el.textarea.value;
  }

  /** Replace the content without firing change listeners. */
  set value(css: string) {
    this.el.textarea.value = css;
    this.render();
  }

  /** Replace content and keep the view scrolled to the end (used while streaming). */
  setStreaming(css: string) {
    this.el.textarea.value = css;
    this.el.textarea.scrollTop = this.el.textarea.scrollHeight;
    this.render();
  }

  onChange(listener: (value: string) => void) {
    this.changeListeners.push(listener);
  }

  setReadOnly(readOnly: boolean) {
    this.el.textarea.readOnly = readOnly;
  }

  setDisabled(disabled: boolean) {
    this.el.textarea.disabled = disabled;
  }

  focus() {
    this.el.textarea.focus();
  }

  hidePopups() {
    this.el.colorPicker.hidden = true;
    this.el.completionList.hidden = true;
  }

  private emitChange() {
    for (const listener of this.changeListeners) listener(this.value);
  }

  private coordinates(lineIndex: number, column: number) {
    const { textarea } = this.el;
    const style = getComputedStyle(textarea);
    const ctx = this.measureContext;
    if (!ctx) throw new Error("Could not measure editor text.");
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const line = textarea.value.split("\n")[lineIndex] ?? "";
    const measured = line.slice(0, column).replace(/\t/g, "  ");
    const lineHeight = Number.parseFloat(style.lineHeight);
    return {
      x: Number.parseFloat(style.paddingLeft) + ctx.measureText(measured).width - textarea.scrollLeft,
      y: Number.parseFloat(style.paddingTop) + lineIndex * lineHeight - textarea.scrollTop,
      lineHeight,
    };
  }

  private completionContext(): { start: number; items: Suggestion[] } | null {
    const { textarea } = this.el;
    const cursor = textarea.selectionStart;
    if (cursor !== textarea.selectionEnd || textarea.readOnly) return null;

    const before = textarea.value.slice(0, cursor);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const commentStart = line.lastIndexOf("/*");
    if (commentStart >= 0 && line.lastIndexOf("*/") < commentStart) return null;

    const boundary = Math.max(line.lastIndexOf("{"), line.lastIndexOf("}"), line.lastIndexOf(";"));
    const declaration = line.slice(boundary + 1);
    const valueMatch = declaration.match(/^\s*([-_a-z][\w-]*)\s*:\s*(.*)$/i);
    if (valueMatch) {
      const prefix = (valueMatch[2] ?? "").match(/[\w#.-]*$/)?.[0] ?? "";
      const property = (valueMatch[1] ?? "").toLowerCase();
      const values = [...(cssValues[property] ?? []), ...commonValues];
      const filtered = values.filter((v) => v.toLowerCase().startsWith(prefix.toLowerCase()));
      if (!filtered.length && !prefix) return null;
      return {
        start: cursor - prefix.length,
        items: filtered.slice(0, 10).map((v) => ({ label: v, insert: v, kind: "value" })),
      };
    }

    const propertyMatch = declaration.match(/^(\s*)([-_a-z][\w-]*)?$/i);
    const prefix = propertyMatch?.[2] ?? "";
    if (!prefix) return null;
    return {
      start: cursor - prefix.length,
      items: cssProperties
        .filter((p) => p.startsWith(prefix.toLowerCase()))
        .slice(0, 10)
        .map((p) => ({ label: p, insert: `${p}: `, kind: "property" })),
    };
  }

  private updateCompletion() {
    const { textarea, completionList } = this.el;
    const context = this.completionContext();
    if (!context?.items.length) {
      this.suggestions = [];
      completionList.hidden = true;
      return;
    }

    this.suggestions = context.items;
    this.selectedSuggestion = Math.min(this.selectedSuggestion, this.suggestions.length - 1);
    completionList.replaceChildren();
    this.suggestions.forEach((suggestion, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "completion-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === this.selectedSuggestion));
      const label = document.createElement("span");
      label.textContent = suggestion.label;
      const kind = document.createElement("span");
      kind.className = "completion-kind";
      kind.textContent = suggestion.kind;
      option.append(label, kind);
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => this.applySuggestion(index));
      completionList.append(option);
    });

    const cursor = textarea.selectionStart;
    const lineIndex = textarea.value.slice(0, cursor).split("\n").length - 1;
    const column = cursor - (textarea.value.lastIndexOf("\n", cursor - 1) + 1);
    const position = this.coordinates(lineIndex, column);
    const width = Math.min(280, Math.max(220, ...this.suggestions.map((s) => s.label.length * 9 + 70)));
    completionList.style.width = `${width}px`;
    completionList.style.left = `${Math.max(4, Math.min(position.x, textarea.clientWidth - width - 4))}px`;
    const below = position.y + position.lineHeight;
    const top = below + 190 > textarea.clientHeight ? position.y - 190 : below;
    completionList.style.top = `${Math.max(4, top)}px`;
    completionList.hidden = false;
  }

  private applySuggestion(index = this.selectedSuggestion) {
    const { textarea, completionList } = this.el;
    const suggestion = this.suggestions[index];
    const context = this.completionContext();
    if (!suggestion || !context) return;
    textarea.setRangeText(suggestion.insert, context.start, textarea.selectionEnd, "end");
    this.suggestions = [];
    completionList.hidden = true;
    textarea.focus();
    this.render();
    this.emitChange();
  }

  private updateColorPicker() {
    const { textarea, colorPicker } = this.el;
    this.colorRange = null;
    const cursor = textarea.selectionStart;
    if (cursor !== textarea.selectionEnd || textarea.readOnly) {
      colorPicker.hidden = true;
      return;
    }

    const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEnd = textarea.value.indexOf("\n", cursor);
    const line = textarea.value.slice(lineStart, lineEnd < 0 ? textarea.value.length : lineEnd);
    const tokenPattern = /#[\da-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b(?:aliceblue|aqua|black|blue|coral|crimson|cyan|fuchsia|gold|gray|green|grey|indigo|ivory|lime|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|red|salmon|silver|teal|violet|white|yellow)\b/gi;

    for (const match of line.matchAll(tokenPattern)) {
      const start = lineStart + (match.index ?? 0);
      const end = start + match[0].length;
      if (cursor < start || cursor > end) continue;
      const color = normalizeColor(match[0]);
      if (!color) continue;

      const lineIndex = textarea.value.slice(0, lineStart).split("\n").length - 1;
      const position = this.coordinates(lineIndex, (match.index ?? 0) + match[0].length);
      const left = position.x + 6 + 34 <= textarea.clientWidth ? position.x + 6 : Math.max(4, position.x - 40);
      colorPicker.style.left = `${left}px`;
      colorPicker.style.top = `${Math.max(2, position.y)}px`;
      colorPicker.value = color;
      this.colorRange = { start, end };
      colorPicker.hidden = false;
      return;
    }
    colorPicker.hidden = true;
  }

  render() {
    if (this.isRendering) return;
    this.isRendering = true;
    const { textarea, highlightedCode, highlightLayer, lineNumbers } = this.el;

    const lines = textarea.value.split("\n");
    const activeLine = textarea.value.slice(0, textarea.selectionStart).split("\n").length - 1;
    let inComment = false;
    const html: string[] = [];
    lines.forEach((line, index) => {
      const highlighted = highlightLine(line, inComment);
      inComment = highlighted.inComment;
      html.push(`<span class="code-line${index === activeLine ? " active" : ""}">${highlighted.html || "&#8203;"}</span>`);
    });

    highlightedCode.innerHTML = html.join("");
    lineNumbers.innerHTML = lines
      .map((_, i) => `<span class="line-number${i === activeLine ? " active" : ""}">${i + 1}</span>`)
      .join("\n");
    highlightLayer.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    lineNumbers.style.transform = `translateY(${-textarea.scrollTop}px)`;
    this.isRendering = false;
    if (document.activeElement === textarea) {
      this.updateCompletion();
      this.updateColorPicker();
    }
  }

  private indentAtCursor(unindent: boolean) {
    const { textarea } = this.el;
    const start = textarea.selectionStart;
    if (unindent) {
      const lineStart = textarea.value.lastIndexOf("\n", start - 1) + 1;
      const leading = textarea.value.slice(lineStart).match(/^ {1,2}/)?.[0] ?? "";
      if (leading) textarea.setRangeText("", lineStart, lineStart + leading.length, "preserve");
      return;
    }
    textarea.setRangeText("  ", start, textarea.selectionEnd, "end");
  }

  private handleKeydown(event: KeyboardEvent) {
    const { textarea, completionList } = this.el;
    if (textarea.readOnly) return;

    if (!completionList.hidden) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        this.selectedSuggestion = (this.selectedSuggestion + direction + this.suggestions.length) % this.suggestions.length;
        this.updateCompletion();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        this.applySuggestion();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        completionList.hidden = true;
        this.suggestions = [];
        return;
      }
    }

    const changed = () => {
      this.render();
      this.emitChange();
    };

    if (event.key === "Tab") {
      event.preventDefault();
      this.indentAtCursor(event.shiftKey);
      changed();
      return;
    }

    const { selectionStart: start, selectionEnd: end } = textarea;

    if ([")", "]", "}", '"', "'"].includes(event.key) && start === end && textarea.value[start] === event.key) {
      event.preventDefault();
      textarea.setSelectionRange(start + 1, start + 1);
      this.render();
      return;
    }

    if (event.key === "Backspace" && start === end && pairs[textarea.value.charAt(start - 1)] === textarea.value.charAt(start)) {
      event.preventDefault();
      textarea.setRangeText("", start - 1, start + 1, "end");
      changed();
      return;
    }

    if (pairs[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if ((event.key === '"' || event.key === "'") && textarea.value[start - 1] === "\\") return;
      event.preventDefault();
      const selected = textarea.value.slice(start, end);
      textarea.setRangeText(`${event.key}${selected}${pairs[event.key]}`, start, end, "select");
      textarea.setSelectionRange(start + 1, start + 1);
      changed();
    }
  }
}
