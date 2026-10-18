const siteName = document.getElementById("site-name");
const nameInput = document.getElementById("style-name");
const editor = document.getElementById("css-editor");
const highlightedCode = document.getElementById("highlighted-code");
const highlightLayer = document.getElementById("highlight-layer");
const lineNumbers = document.getElementById("line-numbers");
const completionList = document.getElementById("completion-list");
const colorPicker = document.getElementById("color-picker");
const saveButton = document.getElementById("save-button");
const newStyleButton = document.getElementById("new-style-button");
const deleteButton = document.getElementById("delete-button");
const status = document.getElementById("status");

const params = new URLSearchParams(window.location.search);
const hostname = params.get("hostname") ?? "";
let editingId = params.get("styleId") ?? "";
let isRendering = false;
let suggestions = [];
let selectedSuggestion = 0;
let colorRange = null;

const cssProperties = [
  "align-items", "background", "background-color", "border", "border-color",
  "border-radius", "box-shadow", "color", "cursor", "display", "filter",
  "flex-direction", "font-family", "font-size", "font-weight", "gap", "height",
  "justify-content", "letter-spacing", "line-height", "margin", "max-height",
  "max-width", "min-height", "min-width", "opacity", "overflow", "padding",
  "position", "text-align", "text-decoration", "transform", "transition",
  "visibility", "white-space", "width", "z-index",
];

const cssValues = {
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

const commonValues = [
  "auto", "none", "inherit", "initial", "unset", "revert", "0", "100%",
];
function setStatus(message) {
  status.textContent = message;
}

function validHostname(value) {
  return /^[a-z0-9.-]+$/i.test(value);
}

function editorCoordinates(lineIndex, column) {
  const style = getComputedStyle(editor);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not measure editor text.");
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const line = editor.value.split("\n")[lineIndex] ?? "";
  const measuredColumn = line.slice(0, column).replace(/\t/g, "  ");
  const x = Number.parseFloat(style.paddingLeft) + context.measureText(measuredColumn).width - editor.scrollLeft;
  const y = Number.parseFloat(style.paddingTop) + lineIndex * Number.parseFloat(style.lineHeight) - editor.scrollTop;
  return { x, y, lineHeight: Number.parseFloat(style.lineHeight) };
}

function getCompletionContext() {
  const cursor = editor.selectionStart;
  if (cursor !== editor.selectionEnd) return null;

  const beforeCursor = editor.value.slice(0, cursor);
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const line = beforeCursor.slice(lineStart);
  const commentStart = line.lastIndexOf("/*");
  if (commentStart >= 0 && line.lastIndexOf("*/") < commentStart) return null;

  const boundary = Math.max(line.lastIndexOf("{"), line.lastIndexOf("}"), line.lastIndexOf(";"));
  const declaration = line.slice(boundary + 1);
  const valueMatch = declaration.match(/^\s*([-_a-z][\w-]*)\s*:\s*(.*)$/i);
  if (valueMatch) {
    const valuePart = valueMatch[2];
    const valuePrefix = valuePart.match(/[\w#.-]*$/)?.[0] ?? "";
    const property = valueMatch[1].toLowerCase();
    const propertyValues = Object.hasOwn(cssValues, property) ? cssValues[property] : [];
    const values = [...propertyValues, ...commonValues];
    const filtered = values.filter((value) => value.toLowerCase().startsWith(valuePrefix.toLowerCase()));
    if (!filtered.length && !valuePrefix) return null;
    return {
      start: cursor - valuePrefix.length,
      items: filtered.slice(0, 10).map((value) => ({ label: value, insert: value, kind: "value" })),
    };
  }

  const propertyMatch = declaration.match(/^(\s*)([-_a-z][\w-]*)?$/i);
  if (!propertyMatch) return null;
  const prefix = propertyMatch[2] ?? "";
  if (!prefix) return null;
  const start = cursor - prefix.length;
  const items = cssProperties
    .filter((property) => property.startsWith(prefix.toLowerCase()))
    .slice(0, 10)
    .map((property) => ({ label: property, insert: `${property}: `, kind: "property" }));
  return { start, items };
}

function updateCompletion() {
  const context = getCompletionContext();
  if (!context?.items.length) {
    suggestions = [];
    completionList.hidden = true;
    return;
  }

  suggestions = context.items;
  selectedSuggestion = Math.min(selectedSuggestion, suggestions.length - 1);
  completionList.replaceChildren();
  suggestions.forEach((suggestion, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "completion-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === selectedSuggestion));
    const label = document.createElement("span");
    label.textContent = suggestion.label;
    const kind = document.createElement("span");
    kind.className = "completion-kind";
    kind.textContent = suggestion.kind;
    option.append(label, kind);
    option.addEventListener("mousedown", (event) => event.preventDefault());
    option.addEventListener("click", () => applySuggestion(index));
    completionList.append(option);
  });

  const cursor = editor.selectionStart;
  const lineIndex = editor.value.slice(0, cursor).split("\n").length - 1;
  const column = cursor - (editor.value.lastIndexOf("\n", cursor - 1) + 1);
  const position = editorCoordinates(lineIndex, column);
  const width = Math.min(280, Math.max(220, ...suggestions.map((item) => item.label.length * 9 + 70)));
  completionList.style.width = `${width}px`;
  completionList.style.left = `${Math.max(4, Math.min(position.x, editor.clientWidth - width - 4))}px`;
  const below = position.y + position.lineHeight;
  const top = below + 190 > editor.clientHeight ? position.y - 190 : below;
  completionList.style.top = `${Math.max(4, top)}px`;
  completionList.hidden = false;
}

function applySuggestion(index = selectedSuggestion) {
  const suggestion = suggestions[index];
  const context = getCompletionContext();
  if (!suggestion || !context) return;
  editor.setRangeText(suggestion.insert, context.start, editor.selectionEnd, "end");
  suggestions = [];
  completionList.hidden = true;
  editor.focus();
  renderEditor();
}

function normalizeColor(value) {
  const probe = document.createElement("span");
  probe.style.color = value;
  if (!probe.style.color) return null;
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const channels = resolved.match(/[\d.]+/g);
  if (!channels || channels.length < 3) return null;
  return `#${channels.slice(0, 3).map((channel) =>
    Math.round(Number(channel)).toString(16).padStart(2, "0"),
  ).join("")}`;
}

function updateColorPicker() {
  colorRange = null;
  const cursor = editor.selectionStart;
  if (cursor !== editor.selectionEnd) {
    colorPicker.hidden = true;
    return;
  }

  const lineStart = editor.value.lastIndexOf("\n", cursor - 1) + 1;
  const lineEnd = editor.value.indexOf("\n", cursor);
  const end = lineEnd < 0 ? editor.value.length : lineEnd;
  const line = editor.value.slice(lineStart, end);
  const tokenPattern = /#[\da-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b(?:aliceblue|aqua|black|blue|coral|crimson|cyan|fuchsia|gold|gray|green|grey|indigo|ivory|lime|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|red|salmon|silver|teal|violet|white|yellow)\b/gi;
  let match;

  while ((match = tokenPattern.exec(line))) {
    const start = lineStart + match.index;
    const tokenEnd = start + match[0].length;
    if (cursor < start || cursor > tokenEnd) continue;
    const color = normalizeColor(match[0]);
    if (!color) continue;

    const lineIndex = editor.value.slice(0, lineStart).split("\n").length - 1;
    const position = editorCoordinates(lineIndex, match.index + match[0].length);
    const left = position.x + 6 + 34 <= editor.clientWidth
      ? position.x + 6
      : Math.max(4, position.x - 40);
    colorPicker.style.left = `${left}px`;
    colorPicker.style.top = `${Math.max(2, position.y)}px`;
    colorPicker.value = color;
    colorRange = { start, end: tokenEnd };
    colorPicker.hidden = false;
    return;
  }

  colorPicker.hidden = true;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function highlightLine(line, startsInComment) {
  const tokenPattern = /\/\*.*?\*\/|\/\*.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@[a-z-]+|!important\b|#[\da-f]{3,8}\b|\b(?:\d+(?:\.\d+)?|\.\d+)(?:%|[a-z]+)?\b|[a-z_-][\w-]*/gi;
  let result = "";
  let position = 0;
  let inComment = startsInComment;

  if (inComment) {
    const commentEnd = line.indexOf("*/");
    if (commentEnd < 0) {
      return { html: `<span class="token-comment">${escapeHtml(line)}</span>`, inComment: true };
    }
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

    const escapedToken = escapeHtml(token);
    result += tokenClass ? `<span class="${tokenClass}">${escapedToken}</span>` : escapedToken;
    cursor = index + token.length;
  }

  result += escapeHtml(remaining.slice(cursor));
  return { html: result, inComment };
}

function renderEditor() {
  if (isRendering) return;
  isRendering = true;

  const lines = editor.value.split("\n");
  const activeLine = editor.value.slice(0, editor.selectionStart).split("\n").length - 1;
  let inComment = false;
  const highlightedLines = [];

  lines.forEach((line, index) => {
    const highlighted = highlightLine(line, inComment);
    inComment = highlighted.inComment;
    highlightedLines.push(
      `<span class="code-line${index === activeLine ? " active" : ""}">${highlighted.html || "&#8203;"}</span>`,
    );
  });

  highlightedCode.innerHTML = highlightedLines.join("");
  lineNumbers.innerHTML = lines.map((_, index) =>
    `<span class="line-number${index === activeLine ? " active" : ""}">${index + 1}</span>`,
  ).join("\n");
  highlightLayer.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  lineNumbers.style.transform = `translateY(${-editor.scrollTop}px)`;
  isRendering = false;
  updateCompletion();
  updateColorPicker();
}

async function loadStyle() {
  if (!validHostname(hostname)) {
    siteName.textContent = "No website selected.";
    saveButton.disabled = true;
    newStyleButton.disabled = true;
    deleteButton.disabled = true;
    editor.disabled = true;
    nameInput.disabled = true;
    setStatus("Open CustomStyle from a website's PageCraft popup.");
    return;
  }

  siteName.textContent = `For ${hostname}`;
  try {
    const { myStyles = [] } = await chrome.storage.local.get({ myStyles: [] });
    const style = Array.isArray(myStyles)
      ? myStyles.find((item) => item?.id === editingId)
      : undefined;

    if (style) {
      nameInput.value = style.name;
      editor.value = style.css;
      deleteButton.hidden = false;
    } else {
      editingId = "";
      deleteButton.hidden = true;
    }
    renderEditor();
  } catch (error) {
    saveButton.disabled = true;
    newStyleButton.disabled = true;
    deleteButton.disabled = true;
    setStatus(`Could not load saved styles: ${error.message}`);
  }
}

async function saveStyle() {
  const name = nameInput.value.trim();
  const css = editor.value.trim();
  if (!name || !css) {
    setStatus("Enter a style name and CSS before saving.");
    return;
  }

  saveButton.disabled = true;
  try {
    const data = await chrome.storage.local.get({
      myStyles: [],
      selectedMyStyles: {},
    });
    const myStyles = Array.isArray(data.myStyles) ? data.myStyles : [];
    const selectedMyStyles = data.selectedMyStyles ?? {};
    const existingIndex = myStyles.findIndex((style) => style?.id === editingId);

    if (existingIndex >= 0) {
      myStyles[existingIndex] = { ...myStyles[existingIndex], name, css };
    } else {
      editingId = crypto.randomUUID();
      myStyles.push({ id: editingId, name, css });
    }

    selectedMyStyles[hostname] = editingId;
    await chrome.storage.local.set({ myStyles, selectedMyStyles });
    deleteButton.hidden = false;
    setStatus(`"${name}" saved and applied to ${hostname}.`);
  } catch (error) {
    setStatus(`Could not save style: ${error.message}`);
  } finally {
    saveButton.disabled = false;
  }
}

function startNewStyle() {
  editingId = "";
  nameInput.value = "";
  editor.value = "";
  deleteButton.hidden = true;
  renderEditor();
  setStatus("Enter a name and CSS for your new style.");
  nameInput.focus();
}

async function removeStyle() {
  if (!editingId) return;

  deleteButton.disabled = true;
  try {
    const data = await chrome.storage.local.get({
      myStyles: [],
      selectedMyStyles: {},
    });
    const myStyles = Array.isArray(data.myStyles)
      ? data.myStyles.filter((style) => style?.id !== editingId)
      : [];
    const selectedMyStyles = data.selectedMyStyles ?? {};

    for (const [site, styleId] of Object.entries(selectedMyStyles)) {
      if (styleId === editingId) delete selectedMyStyles[site];
    }

    await chrome.storage.local.set({ myStyles, selectedMyStyles });
    editingId = "";
    nameInput.value = "";
    editor.value = "";
    deleteButton.hidden = true;
    renderEditor();
    setStatus("Style deleted.");
  } catch (error) {
    setStatus(`Could not delete style: ${error.message}`);
  } finally {
    deleteButton.disabled = false;
  }
}

function indentAtCursor(unindent) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (unindent) {
    const lineStart = editor.value.lastIndexOf("\n", start - 1) + 1;
    const leadingSpaces = editor.value.slice(lineStart).match(/^ {1,2}/)?.[0] ?? "";
    if (leadingSpaces) {
      editor.setRangeText("", lineStart, lineStart + leadingSpaces.length, "preserve");
    }
    return;
  }

  editor.setRangeText("  ", start, end, "end");
}

function handleEditorKeydown(event) {
  if (completionList.hidden === false) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      selectedSuggestion = (selectedSuggestion + direction + suggestions.length) % suggestions.length;
      updateCompletion();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applySuggestion();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      completionList.hidden = true;
      suggestions = [];
      return;
    }
  }

  if (event.key === "Tab") {
    event.preventDefault();
    indentAtCursor(event.shiftKey);
    renderEditor();
    return;
  }

  if ([")", "]", "}", '"', "'"].includes(event.key)
      && editor.selectionStart === editor.selectionEnd
      && editor.value[editor.selectionStart] === event.key) {
    event.preventDefault();
    editor.setSelectionRange(editor.selectionStart + 1, editor.selectionStart + 1);
    renderEditor();
    return;
  }

  if (event.key === "Backspace" && editor.selectionStart === editor.selectionEnd) {
    const cursor = editor.selectionStart;
    const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
    if (pairs[editor.value[cursor - 1]] === editor.value[cursor]) {
      event.preventDefault();
      editor.setRangeText("", cursor - 1, cursor + 1, "end");
      renderEditor();
      return;
    }
  }

  const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
  if (pairs[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if ((event.key === '"' || event.key === "'") && editor.value[start - 1] === "\\") return;
    event.preventDefault();
    const selectedText = editor.value.slice(start, end);
    editor.setRangeText(`${event.key}${selectedText}${pairs[event.key]}`, start, end, "select");
    editor.setSelectionRange(start + 1, start + 1);
    renderEditor();
    return;
  }
}

saveButton.addEventListener("click", saveStyle);
newStyleButton.addEventListener("click", startNewStyle);
deleteButton.addEventListener("click", removeStyle);
editor.addEventListener("input", renderEditor);
editor.addEventListener("click", renderEditor);
editor.addEventListener("keyup", renderEditor);
editor.addEventListener("scroll", renderEditor);
editor.addEventListener("keydown", handleEditorKeydown);
editor.addEventListener("blur", () => {
  completionList.hidden = true;
  window.setTimeout(() => {
    if (document.activeElement !== colorPicker) colorPicker.hidden = true;
  }, 0);
});
colorPicker.addEventListener("input", () => {
  if (!colorRange) return;
  editor.setRangeText(colorPicker.value, colorRange.start, colorRange.end, "end");
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.focus();
});
nameInput.addEventListener("focus", () => {
  colorPicker.hidden = true;
  completionList.hidden = true;
});

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

  if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveStyle();
  } else if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    startNewStyle();
  }
});

loadStyle();
renderEditor();
