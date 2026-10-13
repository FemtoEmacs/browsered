const editor = document.getElementById("editor");
const saveStatus = document.getElementById("saved");
let documentName = "browsered.txt";
// The file opened or saved with Chrome's file picker. Saving writes it in place.
let fileHandle = null;
const filePickerOptions = {
  types: [{
    description: "Text files",
    accept: {"text/plain": [".txt", ".md", ".markdown", ".org", ".tex", ".csv",
                            ".lisp", ".lsp", ".pl", ".lean", ".html", ".json", ".xml"]}
  }]
};

// Restore this browser's last document. No server receives the text.
try {
  editor.value = localStorage.getItem("browsered-note") || "";
  documentName = localStorage.getItem("browsered-filename") || documentName;
} catch {
  saveStatus.textContent = "Local saving unavailable";
}

// Native typing, Emacs edits and prose corrections all send input events.
editor.addEventListener("input", () => {
  try {
    localStorage.setItem("browsered-note", editor.value);
    saveStatus.textContent = fileHandle
      ? "Modified; Ctrl+X Ctrl+S writes " + fileHandle.name
      : "Saved locally";
  } catch {
    saveStatus.textContent = "Use Save to keep your text";
  }
});

// Files are only those the user picks: never a fixed filesystem path.
const toolbar = document.getElementById("browsered-controls").shadowRoot;

function rememberName(name) {
  documentName = name;
  try {
    localStorage.setItem("browsered-filename", documentName);
  } catch {
    // The name is a convenience only.
  }
}

// Without the file picker API (for example in another browser), download.
function downloadDocument() {
  const file = new Blob([editor.value], {type: "text/plain;charset=utf-8"});
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = documentName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  saveStatus.textContent = "Downloaded " + documentName;
}

async function writeDocument(handle) {
  const text = editor.value;
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  fileHandle = handle;
  rememberName(handle.name);
  saveStatus.textContent = editor.value === text
    ? "Wrote " + handle.name
    : "Wrote " + handle.name + "; modified since";
}

// Ctrl+X Ctrl+W: choose a file and write the document there.
async function saveDocumentAs() {
  if (!window.showSaveFilePicker) {
    downloadDocument();
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({...filePickerOptions, suggestedName: documentName});
    await writeDocument(handle);
  } catch (error) {
    if (error.name !== "AbortError") saveStatus.textContent = "Unable to save: " + error.message;
  }
}

// Ctrl+X Ctrl+S: write the visited file, or ask where to save the first time.
async function saveDocument() {
  if (!fileHandle) {
    await saveDocumentAs();
    return;
  }
  try {
    await writeDocument(fileHandle);
  } catch (error) {
    saveStatus.textContent = error.name === "NotAllowedError"
      ? "Chrome did not allow writing " + fileHandle.name
      : "Unable to write " + fileHandle.name + ": " + error.message;
  }
}

toolbar.getElementById("save").addEventListener("click", saveDocument);

// Clipboard access happens only when the user clicks one of these buttons.
toolbar.getElementById("copy-all").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(editor.value);
    saveStatus.textContent = "Whole document copied";
  } catch {
    saveStatus.textContent = "Copy blocked by browser clipboard settings";
  }
});

toolbar.getElementById("paste").addEventListener("click", async () => {
  const selectionStart = editor.selectionStart;
  const selectionEnd = editor.selectionEnd;
  const previousText = editor.value;

  try {
    const pastedText = await navigator.clipboard.readText();
    if (editor.value !== previousText) {
      saveStatus.textContent = "Text changed while reading clipboard; please paste again";
      return;
    }
    if (!pastedText) {
      saveStatus.textContent = "Clipboard contains no text";
      return;
    }

    editor.focus();
    editor.setSelectionRange(selectionStart, selectionEnd);
    // Retain the browser's undo history and notify the prose checker.
    const inserted = document.execCommand("insertText", false, pastedText);
    if (!inserted && editor.value === previousText) {
      const beforeInput = new InputEvent("beforeinput", {
        bubbles: true, cancelable: true, inputType: "insertFromPaste", data: pastedText
      });
      if (!editor.dispatchEvent(beforeInput)) return;
      editor.setRangeText(pastedText, selectionStart, selectionEnd, "end");
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType: "insertFromPaste", data: pastedText
      }));
    }
  } catch {
    saveStatus.textContent = "Paste blocked; click the editor and use Command+V";
  }
});

// Use Chrome's file picker. Only the selected file is read, on this computer.
const filePicker = document.createElement("input");
filePicker.type = "file";
filePicker.hidden = true;
document.body.appendChild(filePicker);

// Ctrl+X Ctrl+F: visit a file. Saving then writes back to that same file.
async function openDocument() {
  if (!window.showOpenFilePicker) {
    // Reset so the same file can be selected again.
    filePicker.value = "";
    filePicker.click();
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker(filePickerOptions);
  } catch (error) {
    if (error.name !== "AbortError") saveStatus.textContent = "Unable to open: " + error.message;
    return;
  }
  const previousText = editor.value;
  try {
    const file = await handle.getFile();
    if (loadDocument(previousText, await file.text(), file.name)) fileHandle = handle;
  } catch {
    saveStatus.textContent = "Unable to read " + handle.name;
  }
}

toolbar.getElementById("open").addEventListener("click", openDocument);
globalThis.browseredFileCommands = {
  open: openDocument, save: saveDocument, saveAs: saveDocumentAs, name: () => documentName
};

filePicker.addEventListener("change", async () => {
  const selectedFile = filePicker.files[0];
  if (!selectedFile) return;
  const previousText = editor.value;
  try {
    // The fallback picker gives no handle, so saving downloads a copy.
    if (loadDocument(previousText, await selectedFile.text(), selectedFile.name)) fileHandle = null;
  } catch {
    saveStatus.textContent = "Unable to read the selected file";
  }
});

function loadDocument(previousText, loadedText, name) {
  if (editor.value !== previousText) {
    saveStatus.textContent = "Text changed while loading; please open again";
    return false;
  }

  // Replace the buffer through the native edit history, allowing undo.
  editor.focus();
  editor.setSelectionRange(0, editor.value.length);
  const command = loadedText ? "insertText" : "delete";
  const inserted = document.execCommand(command, false, loadedText);
  if (!inserted && editor.value === previousText) {
    editor.value = loadedText;
    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true, inputType: "insertText", data: loadedText
    }));
  }
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  rememberName(name);
  try {
    localStorage.setItem("browsered-note", editor.value);
  } catch {
    // Loading still works when local storage is unavailable.
  }
  saveStatus.textContent = "Opened " + documentName;
  return true;
}

// Installed or not, the hosted version keeps working offline.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
