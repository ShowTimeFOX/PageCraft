const siteName = document.getElementById("site-name");
const nameInput = document.getElementById("style-name");
const editor = document.getElementById("css-editor");
const saveButton = document.getElementById("save-button");
const newStyleButton = document.getElementById("new-style-button");
const deleteButton = document.getElementById("delete-button");
const status = document.getElementById("status");

const params = new URLSearchParams(window.location.search);
const hostname = params.get("hostname") ?? "";
let editingId = params.get("styleId") ?? "";

function setStatus(message) {
  status.textContent = message;
}

function validHostname(value) {
  return /^[a-z0-9.-]+$/i.test(value);
}

async function loadStyle() {
  if (!validHostname(hostname)) {
    siteName.textContent = "No website selected.";
    saveButton.disabled = true;
    deleteButton.disabled = true;
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
  } catch (error) {
    saveButton.disabled = true;
    deleteButton.disabled = true;
    setStatus(`Could not load saved styles: ${error.message}`);
  }
}

saveButton.addEventListener("click", async () => {
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
});

newStyleButton.addEventListener("click", () => {
  editingId = "";
  nameInput.value = "";
  editor.value = "";
  deleteButton.hidden = true;
  setStatus("Enter a name and CSS for your new style.");
  nameInput.focus();
});

deleteButton.addEventListener("click", async () => {
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
    setStatus("Style deleted.");
  } catch (error) {
    setStatus(`Could not delete style: ${error.message}`);
  } finally {
    deleteButton.disabled = false;
  }
});

loadStyle();
