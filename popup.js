const siteName = document.getElementById("site-name");
const editor = document.getElementById("css-editor");
const saveButton = document.getElementById("save-button");
const status = document.getElementById("status");

let currentHostname = "";

async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? "");

    if (!["http:", "https:"].includes(url.protocol)) {
      siteName.textContent = "PageCraft works on regular websites.";
      editor.disabled = true;
      saveButton.disabled = true;
      return;
    }

    currentHostname = url.hostname;
    siteName.textContent = currentHostname;
    const { styles = {} } = await chrome.storage.local.get({ styles: {} });
    editor.value = styles[currentHostname] ?? "";
  } catch (error) {
    siteName.textContent = "Could not load this site.";
    editor.disabled = true;
    saveButton.disabled = true;
    status.textContent = error.message;
  }
}

saveButton.addEventListener("click", async () => {
  if (!currentHostname) return;

  saveButton.disabled = true;
  status.textContent = "";

  try {
    const { styles = {} } = await chrome.storage.local.get({ styles: {} });
    const css = editor.value;

    if (css.trim()) {
      styles[currentHostname] = css;
    } else {
      delete styles[currentHostname];
    }

    await chrome.storage.local.set({ styles });
    status.textContent = css.trim() ? "Style saved and applied." : "Style removed.";
  } catch (error) {
    status.textContent = `Could not save style: ${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
});

loadCurrentSite();
