import { browser } from "wxt/browser";
import type { ThemeImage } from "./ai/prompt";

const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.72;

type CaptureTab = (tabId: number, options?: { format?: "jpeg" | "png"; quality?: number }) => Promise<string>;

/**
 * Screenshot the visible part of a tab, downscaled to keep the request small.
 *
 * Firefox can capture any tab directly (tabs.captureTab). Chrome can only capture the active
 * tab of a window, so the site tab is brought to the front briefly and the previous tab restored.
 */
export async function captureTab(tabId: number): Promise<ThemeImage> {
  const captureAny = (browser.tabs as unknown as { captureTab?: CaptureTab }).captureTab;
  let dataUrl: string;
  if (typeof captureAny === "function") {
    dataUrl = await captureAny(tabId, { format: "jpeg", quality: 85 });
  } else {
    const tab = await browser.tabs.get(tabId);
    const [active] = await browser.tabs.query({ active: true, windowId: tab.windowId });
    const switchBack = active?.id !== undefined && active.id !== tabId ? active.id : null;
    if (switchBack !== null) {
      await browser.tabs.update(tabId, { active: true });
      await new Promise((resolve) => setTimeout(resolve, 400)); // let the tab paint
    }
    try {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });
    } finally {
      if (switchBack !== null) await browser.tabs.update(switchBack, { active: true });
    }
  }
  return downscale(dataUrl);
}

async function downscale(dataUrl: string): Promise<ThemeImage> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const jpeg = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { mediaType: "image/jpeg", data: jpeg.slice(jpeg.indexOf(",") + 1) };
}
