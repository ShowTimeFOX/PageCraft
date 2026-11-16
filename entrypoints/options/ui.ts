/** Small helpers shared by the settings page sections. */

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function setStatus(element: HTMLElement, message: string, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function button(label: string, className = "secondary small"): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = label;
  return el;
}
