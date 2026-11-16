/**
 * CSS editor built on CodeMirror 6, behind a small API (value, onChange, setReadOnly, …)
 * so the rest of the editor page doesn't depend on CodeMirror directly.
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { linter, lintKeymap, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import parse from "css-tree/parser";
import { parseColor, toCss } from "@/lib/contrast";

/** Marks programmatic changes that must not notify change listeners. */
const silent = Annotation.define<boolean>();

// ------------------------------------------------------------------ theme

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--editor-bg)", color: "var(--editor-fg)", fontSize: "13px" },
  ".cm-scroller": { fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--editor-blue)", padding: "10px 0" },
  ".cm-cursor": { borderLeftColor: "var(--editor-blue)" },
  ".cm-gutters": { backgroundColor: "var(--editor-bg)", color: "var(--editor-muted)", border: "none", borderRight: "1px solid var(--editor-border)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--editor-active)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--editor-blue) 28%, transparent) !important" },
  ".cm-tooltip": { backgroundColor: "var(--editor-bg)", border: "1px solid var(--editor-border)", color: "var(--editor-fg)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--editor-active)", color: "var(--editor-fg)" },
  ".cm-panels": { backgroundColor: "var(--editor-bg)", color: "var(--editor-fg)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--editor-orange) 30%, transparent)" },
  ".cm-placeholder": { color: "var(--editor-muted)" },
  ".cm-color-swatch": {
    display: "inline-block",
    width: "11px",
    height: "11px",
    margin: "0 4px 0 1px",
    verticalAlign: "-1px",
    border: "1px solid var(--editor-border)",
    borderRadius: "2px",
    position: "relative",
    overflow: "hidden",
  },
  ".cm-color-swatch input": { position: "absolute", inset: "-4px", width: "20px", height: "20px", opacity: "0", cursor: "pointer", border: "0", padding: "0" },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "var(--editor-muted)", fontStyle: "italic" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--editor-blue)" },
  { tag: [tags.number, tags.unit, tags.integer], color: "var(--editor-orange)" },
  { tag: [tags.string, tags.color, tags.atom], color: "var(--editor-green)" },
  { tag: [tags.keyword, tags.definitionKeyword, tags.modifier, tags.controlKeyword], color: "var(--editor-purple)" },
  { tag: [tags.className, tags.tagName, tags.labelName], color: "var(--editor-fg)", fontWeight: "600" },
  { tag: tags.variableName, color: "var(--editor-green)" },
  { tag: tags.invalid, color: "var(--editor-orange)", textDecoration: "underline wavy" },
]);

// ------------------------------------------------------------ color swatches

const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\([^()\n]*\)/gi;

let colorProbe: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS color to RGBA via the canvas (handles hsl, oklch, …). */
function resolveColor(value: string) {
  const parsed = parseColor(value);
  if (parsed) return parsed;
  colorProbe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!colorProbe) return null;
  colorProbe.fillStyle = "#010203";
  colorProbe.fillStyle = value;
  if (colorProbe.fillStyle === "#010203" && value.toLowerCase() !== "#010203") return null;
  colorProbe.clearRect(0, 0, 1, 1);
  colorProbe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = colorProbe.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255] as [number, number, number, number];
}

const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

class ColorSwatch extends WidgetType {
  constructor(private readonly color: string) {
    super();
  }

  override eq(other: ColorSwatch) {
    return other.color === this.color;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-color-swatch";
    wrap.style.background = this.color;
    const rgba = resolveColor(this.color);
    const input = document.createElement("input");
    input.type = "color";
    input.title = "Pick a color";
    if (rgba) input.value = `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`;
    input.addEventListener("input", () => {
      const pos = view.posAtDOM(wrap);
      const line = view.state.doc.lineAt(pos);
      const rest = line.text.slice(pos - line.from);
      const match = rest.match(new RegExp(`^(?:${COLOR_TOKEN.source})`, "i"));
      if (!match) return;
      const alpha = rgba?.[3] ?? 1;
      const picked = input.value;
      const replacement =
        alpha < 1
          ? toCss([Number.parseInt(picked.slice(1, 3), 16), Number.parseInt(picked.slice(3, 5), 16), Number.parseInt(picked.slice(5, 7), 16), alpha])
          : picked;
      view.dispatch({ changes: { from: pos, to: pos + match[0].length, insert: replacement }, userEvent: "input.color" });
    });
    wrap.append(input);
    return wrap;
  }

  override ignoreEvent() {
    return true;
  }
}

function buildSwatches(view: EditorView): DecorationSet {
  const widgets = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const match of text.matchAll(COLOR_TOKEN)) {
      if (!resolveColor(match[0])) continue;
      widgets.push(Decoration.widget({ widget: new ColorSwatch(match[0]), side: -1 }).range(from + (match.index ?? 0)));
    }
  }
  return Decoration.set(widgets, true);
}

const colorSwatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildSwatches(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = buildSwatches(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// --------------------------------------------------------------------- lint

const cssLinter = linter(
  (view) => {
    const text = view.state.doc.toString();
    if (!text.trim() || text.length > 200_000) return [];
    const diagnostics: Diagnostic[] = [];
    parse(text, {
      positions: true,
      parseCustomProperty: false,
      onParseError(error) {
        const offset = Math.min(Math.max(0, (error as { offset?: number }).offset ?? 0), text.length);
        const line = view.state.doc.lineAt(offset);
        diagnostics.push({
          from: offset,
          to: Math.max(offset + 1, Math.min(line.to, offset + 20)),
          severity: "warning",
          message: `CSS syntax: ${error.message}`,
        });
      },
    });
    return diagnostics.slice(0, 50);
  },
  { delay: 600 },
);

// ------------------------------------------------------------------- editor

export class CssEditor {
  private readonly view: EditorView;
  private readonly editable = new Compartment();
  private readonly readOnly = new Compartment();
  private changeListeners: ((value: string) => void)[] = [];
  /** Document before streaming started, so the final result becomes one undo step. */
  private streamBase: string | null = null;

  constructor(parent: HTMLElement, placeholderText = "") {
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          css(),
          syntaxHighlighting(highlightStyle),
          editorTheme,
          colorSwatches,
          cssLinter,
          placeholder(placeholderText),
          EditorView.lineWrapping,
          this.editable.of(EditorView.editable.of(true)),
          this.readOnly.of(EditorState.readOnly.of(false)),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.some((tr) => tr.annotation(silent))) return;
            const value = update.state.doc.toString();
            for (const listener of this.changeListeners) listener(value);
          }),
        ],
      }),
    });
  }

  get value(): string {
    return this.view.state.doc.toString();
  }

  /** Replace the content without notifying listeners or adding an undo step (e.g. loading a style). */
  set value(css: string) {
    this.dispatchReplace(css, { silent: true, history: false });
  }

  /** Replace the content as one undoable edit (Ctrl+Z restores the previous text). */
  replace(css: string) {
    this.dispatchReplace(css, { silent: true, history: true });
  }

  /** Show partial output while streaming. Call finishStreaming() with the final text. */
  setStreaming(css: string) {
    this.streamBase ??= this.value;
    this.dispatchReplace(css, { silent: true, history: false });
    this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.doc.length) });
  }

  /** End streaming: restore the original silently, then apply the result as a single undo step. */
  finishStreaming(finalCss: string | null) {
    const base = this.streamBase;
    this.streamBase = null;
    if (base === null) {
      if (finalCss !== null) this.replace(finalCss);
      return;
    }
    this.dispatchReplace(base, { silent: true, history: false });
    if (finalCss !== null && finalCss !== base) this.replace(finalCss);
  }

  onChange(listener: (value: string) => void) {
    this.changeListeners.push(listener);
  }

  setReadOnly(readOnly: boolean) {
    this.view.dispatch({ effects: this.readOnly.reconfigure(EditorState.readOnly.of(readOnly)) });
  }

  setDisabled(disabled: boolean) {
    this.view.dispatch({ effects: this.editable.reconfigure(EditorView.editable.of(!disabled)) });
  }

  focus() {
    this.view.focus();
  }

  /** Kept for API compatibility; CodeMirror manages its own popups. */
  hidePopups() {}

  private dispatchReplace(css: string, options: { silent: boolean; history: boolean }) {
    if (css === this.value) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: css },
      annotations: [silent.of(options.silent), Transaction.addToHistory.of(options.history)],
    });
  }
}
