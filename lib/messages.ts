/** Messages between extension pages and the content script. */

export interface PageDigest {
  url: string;
  title: string;
  lang: string;
  colorScheme: string;
  customProperties: string[];
  backgrounds: string[];
  textColors: string[];
  fonts: string[];
  outline: string;
}

export type ContentRequest =
  | { type: "pagecraft:get-digest"; size?: "small" | "normal" | "large" }
  | { type: "pagecraft:contrast" }
  | { type: "pagecraft:ping" };

/** Name of the port an editor opens to a tab for live preview. */
export const PREVIEW_PORT = "pagecraft:preview";

/** Messages sent over the preview port. Disconnecting the port clears the preview. */
export type PreviewMessage = { type: "set"; css: string } | { type: "clear" };
