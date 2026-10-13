(() => {
  "use strict";
  // Pure text navigation: positions are UTF-16 offsets, as in textarea selection.
  const movement = {
    lineStart(text, position) {
      if (position === 0) return 0;
      return text.lastIndexOf("\n", position - 1) + 1;
    },
    lineEnd(text, position) {
      const end = text.indexOf("\n", position);
      return end < 0 ? text.length : end;
    },
    nextChar(text, position) {
      // A character outside the BMP occupies two UTF-16 code units.
      const width = text.codePointAt(position) > 65535 ? 2 : 1;
      return Math.min(text.length, position + width);
    },
    prevChar(text, position) {
      if (!position) return 0;
      const codeUnit = text.charCodeAt(position - 1);
      return position - (codeUnit >= 0xdc00 && codeUnit <= 0xdfff && position > 1 &&
        text.charCodeAt(position - 2) >= 0xd800 && text.charCodeAt(position - 2) <= 0xdbff ? 2 : 1);
    },
    word(text, position, direction) {
      const wordChar = codeUnit => codeUnit !== undefined && /[\p{L}\p{N}_]/u.test(codeUnit);
      if (direction > 0) {
        while (position < text.length && !wordChar(String.fromCodePoint(text.codePointAt(position)))) position = movement.nextChar(text, position);
        while (position < text.length && wordChar(String.fromCodePoint(text.codePointAt(position)))) position = movement.nextChar(text, position);
      } else {
        while (position > 0 && !wordChar(text.slice(movement.prevChar(text, position), position))) position = movement.prevChar(text, position);
        while (position > 0 && wordChar(text.slice(movement.prevChar(text, position), position))) position = movement.prevChar(text, position);
      }
      return position;
    },
    vertical(text, position, direction, column) {
      const start = movement.lineStart(text, position);
      if (direction < 0) {
        if (!start) return 0;
        const previous = movement.lineStart(text, start - 1);
        return Math.min(start - 1, previous + column);
      }
      const end = movement.lineEnd(text, position);
      if (end === text.length) return end;
      return Math.min(movement.lineEnd(text, end + 1), end + 1 + column);
    }
  };


  // Repeated extension clicks toggle one listener, rather than adding copies.
  const stateKey = "__browseredEmacsKeys";
  if (globalThis[stateKey]) {
    globalThis[stateKey].toggle();
    return globalThis[stateKey].enabled;
  }

  // Keep the selection mark and vertical goal column separate for each field.
  const fieldStates = new WeakMap();
  let killBuffer = "";
  let lastKillField = null;
  let lastKillDirection = 0;
  let lastEditor = null;
  let helpPrefixPending = false;
  let ctrlXPending = false;
  // Text this script last placed on the system clipboard (see yank).
  let lastClipboardText = null;
  // Incremental search state while Ctrl+S or Ctrl+R is active.
  let search = null;
  let lastSearchQuery = "";
  // Keys typed so far toward a multi-key binding from Scheme (e.g. "C-c").
  let userPending = null;

  // This table supplies both the help panel and the standalone bindings page.
  const bindings = [
    ["Ctrl+H", "Open or close help; begin a help-key sequence"],
    ["Ctrl+H, then R", "Ask Claude about the document"],
    ["Ctrl+H, then G", "Ask ChatGPT about the document"],
    ["Ctrl+H, then K", "Show all keybindings"],
    ["Ctrl+A / Ctrl+E", "Beginning / end of logical line"],
    ["Ctrl+B / Ctrl+F", "Previous / next character"],
    ["Ctrl+P / Ctrl+N", "Previous / next logical line, keeping the column"],
    ["Alt+B / Alt+F", "Previous / next word"],
    ["Alt+< / Alt+>", "Beginning / end of text"],
    ["Ctrl+Space or Ctrl+@", "Set the selection mark"],
    ["Shift with movement", "Extend the selection"],
    ["Ctrl+X, Ctrl+X", "Exchange cursor and mark"],
    ["Ctrl+X, then H", "Select the whole document"],
    ["Ctrl+G", "Cancel the mark, a search, or help"],
    ["Ctrl+K", "Kill to line end; at line end, kill the newline"],
    ["Ctrl+W", "Kill (cut) the selected region"],
    ["Alt+W", "Copy the selected region"],
    ["Alt+D / Alt+Backspace", "Kill next / previous word"],
    ["Ctrl+Y", "Yank (paste) the last kill or copied text"],
    ["Ctrl+D / Backspace", "Delete next / previous character, or the region"],
    ["Ctrl+S / Ctrl+R", "Incremental search forward / backward"],
    ["Ctrl+X, Ctrl+F", "Open a file"],
    ["Ctrl+X, Ctrl+S", "Save to the file"],
    ["Ctrl+X, Ctrl+W", "Save to a new file"],
    ["Ctrl+/, Ctrl+_ or Ctrl+X U", "Undo using the browser's edit history"],
    ["Alt+: (M-:)", "Evaluate a Scheme expression"],
    ["Alt+X (M-x)", "Run a Scheme command by name (Tab completes)"],
    ["Ctrl+X, Ctrl+E", "Evaluate the Scheme expression before the cursor and insert its value"],
    ["Ctrl+H, then E", "Show Scheme messages and output"],
    ["Ctrl+L", "Center the current logical line"],
    ["Esc (in help)", "Close help and return to the editor"]
  ];

  // A shadow root keeps website styles from changing the controls.
  // The actual editor stays in the ordinary page DOM for the prose checker.
  const controlsHost = document.createElement("div");
  controlsHost.id = "browsered-controls";
  const controls = controlsHost.attachShadow({mode: "open"});
  const styles = document.createElement("style");
  const toolbarSlot = document.getElementById("browsered-toolbar-slot");
  const hostLayout = toolbarSlot
    ? "display: block;"
    : "position: fixed; top: 12px; right: 16px; z-index: 2147483647;";
  styles.textContent = `
    :host { ${hostLayout} }
    * { box-sizing: border-box; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; background: #f4f6f4;
          border: 1px solid #b3bdb5; border-radius: 8px; }
    button, a { font: 14px system-ui; border: 0; border-radius: 5px;
                padding: 8px 12px; background: #176b46; color: white;
                cursor: pointer; text-decoration: none; }
    dialog { position: fixed; inset: 0; width: min(680px, 90vw);
             max-height: 85vh; overflow: auto; padding: 24px;
             border: 1px solid #b3bdb5; border-radius: 10px;
             background: white; color: #202a25; font: 16px/1.5 system-ui; }
    dialog::backdrop { background: #0006; }
    h2 { margin-top: 0; }
    table { border-collapse: collapse; width: 100%; }
    td { padding: 6px 10px; border-bottom: 1px solid #e5e9e6; }
    td:first-child { font-family: monospace; white-space: nowrap; }
    .close { float: right; }
    [hidden] { display: none; }
    /* The echo area: messages and results at the bottom, as in Emacs. */
    .status { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646;
              max-height: 40vh; overflow: auto; padding: 8px 16px;
              background: #f4f6f4; border-top: 1px solid #b3bdb5; color: #176b46;
              font: 15px ui-monospace, Menlo, monospace; white-space: pre-wrap; }
    .status:empty { display: none; }
    .minibuffer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
                  display: flex; align-items: center; gap: 8px; padding: 8px 16px;
                  background: #f4f6f4; border-top: 1px solid #b3bdb5;
                  font: 15px ui-monospace, Menlo, monospace; color: #202a25; }
    .minibuffer[hidden] { display: none; }
    .minibuffer input { flex: 1; font: inherit; padding: 5px 8px; color: inherit;
                        border: 1px solid #b3bdb5; border-radius: 4px; background: white; }
    .messages { white-space: pre-wrap; font: 13px/1.5 ui-monospace, Menlo, monospace;
                max-height: 60vh; overflow: auto; margin: 0; }
    .messages .error { color: #a12c2c; }
    .messages .output { color: #4d5a52; }
  `;
  controls.appendChild(styles);

  const toolbar = document.createElement("nav");
  toolbar.setAttribute("aria-label", "Browsered toolbar");

  // Move the editor's existing Save button into the shared toolbar.
  if (toolbarSlot) {
    const openButton = document.createElement("button");
    openButton.id = "open";
    openButton.textContent = "Open";
    toolbar.appendChild(openButton);
    const downloadButton = document.getElementById("save");
    if (downloadButton) toolbar.appendChild(downloadButton);

    for (const [id, label] of [["copy-all", "Copy all"], ["paste", "Paste"]]) {
      const button = document.createElement("button");
      button.id = id;
      button.textContent = label;
      toolbar.appendChild(button);
    }
  }
  const helpButton = document.createElement("button");
  helpButton.textContent = "Keybindings (Ctrl+H)";
  toolbar.appendChild(helpButton);

  function addLink(label, url) {
    const link = document.createElement("a");
    link.textContent = label;
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    toolbar.appendChild(link);
  }

  // Both assistants answer inside Browsered through the local helper.
  const claudeHelpButton = document.createElement("button");
  claudeHelpButton.id = "claude-help";
  claudeHelpButton.textContent = "Claude";
  claudeHelpButton.addEventListener("click", () => openQuestionDialog("claude"));
  toolbar.appendChild(claudeHelpButton);
  const chatGPTHelpButton = document.createElement("button");
  chatGPTHelpButton.id = "chatgpt-help";
  chatGPTHelpButton.textContent = "ChatGPT";
  chatGPTHelpButton.addEventListener("click", () => openQuestionDialog("chatgpt"));
  toolbar.appendChild(chatGPTHelpButton);
  addLink("Codex", "https://chatgpt.com/codex");
  controls.appendChild(toolbar);

  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  controls.appendChild(status);

  // Ask for the user's question before preparing the ChatGPT prompt.
  const questionDialog = document.createElement("dialog");
  questionDialog.setAttribute("aria-label", "Ajuda do Browsered");
  const questionHeading = document.createElement("h2");
  questionHeading.textContent = "Ajuda do Browsered";
  questionDialog.appendChild(questionHeading);

  const questionForm = document.createElement("form");
  const questionField = document.createElement("textarea");
  questionField.setAttribute("aria-label", "Sua pergunta");
  questionField.rows = 5;
  questionField.style.cssText = "display:block;width:100%;margin-bottom:16px;font:16px/1.5 system-ui;padding:12px";
  questionForm.appendChild(questionField);

  const askButton = document.createElement("button");
  askButton.type = "submit";
  askButton.textContent = "Enviar pedido e documento";
  questionForm.appendChild(askButton);
  const cancelQuestion = document.createElement("button");
  cancelQuestion.type = "button";
  cancelQuestion.textContent = "Cancelar";
  cancelQuestion.style.marginLeft = "8px";
  questionForm.appendChild(cancelQuestion);
  questionDialog.appendChild(questionForm);
  controls.appendChild(questionDialog);

  function closeQuestionDialog() {
    questionDialog.close();
    if (lastEditor?.isConnected) lastEditor.focus();
  }

  const assistants = {
    claude: {name: "Claude", endpoint: "/claude"},
    chatgpt: {name: "ChatGPT", endpoint: "/assistant"}
  };
  let assistant = assistants.chatgpt;

  // The assistant runs through Browsered.app's local helper. Elsewhere
  // (GitHub Pages, a file, the extension) the buttons open the websites.
  const nativeHelper = location.origin === "http://127.0.0.1:8766";
  const assistantSites = {claude: "https://claude.ai/", chatgpt: "https://chatgpt.com/"};

  function openQuestionDialog(provider) {
    if (!nativeHelper) {
      window.open(assistantSites[provider] || assistantSites.chatgpt, "_blank", "noopener,noreferrer");
      return;
    }
    assistant = assistants[provider] || assistants.chatgpt;
    questionHeading.textContent = "Pedir ao " + assistant.name;
    questionDialog.setAttribute("aria-label", "Pedir ao " + assistant.name);
    questionField.value = "";
    assistantResult.textContent = "";
    helpPrefixPending = false;
    if (helpDialog.open) closeHelp();
    questionDialog.showModal();
    questionField.focus();
  }

  cancelQuestion.addEventListener("click", closeQuestionDialog);
  questionDialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeQuestionDialog();
  });
  // Show the assistant's completed work here, without opening another window.
  const assistantResult = document.createElement("div");
  assistantResult.setAttribute("role", "status");
  assistantResult.style.cssText = "margin-top:16px;white-space:pre-wrap";
  questionDialog.appendChild(assistantResult);
  const artifactURLs = [];

  // Claude Code prints {type: "result", result: "<text>"}; the text should be
  // the JSON object the prompt asked for, possibly inside a code fence.
  function claudeResult(envelope) {
    const final = Array.isArray(envelope)
      ? envelope.findLast(message => message?.type === "result")
      : envelope;
    if (!final || final.is_error || typeof final.result !== "string") {
      throw new Error("O Claude não conseguiu concluir o pedido.");
    }
    const text = final.result.trim();
    const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
    const candidates = [fenced ? fenced[1] : text];
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed?.reply === "string") {
          return {reply: parsed.reply, artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : []};
        }
      } catch {
        // Try the next candidate.
      }
    }
    // A plain answer is still useful; it just carries no files.
    return {reply: text, artifacts: []};
  }

  questionForm.addEventListener("submit", async event => {
    event.preventDefault();
    const question = questionField.value.trim();
    if (!question) {
      questionField.focus();
      return;
    }
    const documentText = document.getElementById("editor")?.value || lastEditor?.value || "";
    askButton.disabled = true;
    questionField.readOnly = true;
    assistantResult.textContent = "O assistente está executando seu pedido…";
    for (const url of artifactURLs) URL.revokeObjectURL(url);
    artifactURLs.length = 0;

    try {
      const requested = assistant;
      const response = await fetch(requested.endpoint, {
        method: "POST",
        headers: {"Content-Type": "text/plain;charset=utf-8"},
        body: "Pedido do usuário:\n" + question + "\n\nDocumento atual:\n" + documentText
      });
      if (!response.ok) {
        throw new Error(requested === assistants.claude
          ? "O Claude não conseguiu concluir o pedido. Verifique se o Claude Code " +
            "(comando claude) está instalado e com login feito."
          : "O assistente não conseguiu concluir o pedido.");
      }
      const envelope = await response.json();
      const result = requested === assistants.claude ? claudeResult(envelope) : envelope;
      if (typeof result.reply !== "string" || !Array.isArray(result.artifacts)) {
        throw new Error("O assistente devolveu uma resposta inválida.");
      }
      assistantResult.textContent = result.reply;

      for (const artifact of result.artifacts) {
        if (typeof artifact.content !== "string" || typeof artifact.name !== "string") continue;
        let file;
        if (artifact.format === "pdf") {
          const rendered = await fetch("/pdf", {
            method: "POST",
            headers: {"Content-Type": "text/plain;charset=utf-8"},
            body: artifact.content
          });
          if (!rendered.ok) throw new Error("Não foi possível finalizar o PDF.");
          file = await rendered.blob();
        } else {
          file = new Blob([artifact.content], {type: "text/plain;charset=utf-8"});
        }
        const url = URL.createObjectURL(file);
        artifactURLs.push(url);
        const download = document.createElement("a");
        download.href = url;
        download.download = artifact.name.replace(/[\\/]/g, "_");
        download.textContent = "Baixar " + download.download;
        download.style.cssText = "display:inline-block;margin:12px 8px 0 0";
        assistantResult.appendChild(document.createElement("br"));
        assistantResult.appendChild(download);
      }
    } catch (error) {
      assistantResult.textContent = error.message;
    } finally {
      askButton.disabled = false;
      questionField.readOnly = false;
    }
  });

  const helpDialog = document.createElement("dialog");
  helpDialog.setAttribute("aria-label", "Browsered keybindings");
  const closeHelpButton = document.createElement("button");
  closeHelpButton.className = "close";
  closeHelpButton.textContent = "Close";
  helpDialog.appendChild(closeHelpButton);
  const heading = document.createElement("h2");
  heading.textContent = "Browsered keybindings";
  helpDialog.appendChild(heading);

  const helpTable = document.createElement("table");
  for (const [keys, description] of bindings) {
    const row = document.createElement("tr");
    for (const value of [keys, description]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }
    helpTable.appendChild(row);
  }
  helpDialog.appendChild(helpTable);
  const helpNote = document.createElement("p");
  helpNote.textContent = "Use Alt on your Kinesis. Consecutive kills join together. " +
    "Normal Command shortcuts stay with Chrome. Ctrl+Space may switch macOS " +
    "input sources; Shift with movement also selects text.";
  helpDialog.appendChild(helpNote);
  controls.appendChild(helpDialog);

  // Minibuffer for M-: and M-x, at the bottom of the page as in Emacs.
  const minibuffer = document.createElement("form");
  minibuffer.className = "minibuffer";
  minibuffer.hidden = true;
  const minibufferPrompt = document.createElement("label");
  const minibufferInput = document.createElement("input");
  minibufferInput.type = "text";
  minibufferInput.autocomplete = "off";
  minibufferInput.spellcheck = false;
  minibufferPrompt.appendChild(document.createTextNode(""));
  minibuffer.append(minibufferPrompt, minibufferInput);
  minibufferPrompt.htmlFor = "";
  controls.appendChild(minibuffer);
  let minibufferHandler = null;
  let minibufferKind = null;
  const minibufferHistory = {expression: [], command: []};
  let historyIndex = 0;

  function readMinibuffer(prompt, kind, handler) {
    minibufferPrompt.firstChild.textContent = prompt;
    minibufferInput.value = "";
    minibufferHandler = handler;
    minibufferKind = kind;
    historyIndex = minibufferHistory[kind].length;
    minibuffer.hidden = false;
    minibufferInput.focus();
  }

  function closeMinibuffer() {
    minibuffer.hidden = true;
    minibufferHandler = null;
    if (lastEditor?.isConnected) lastEditor.focus();
  }

  minibuffer.addEventListener("submit", event => {
    event.preventDefault();
    const value = minibufferInput.value;
    const handler = minibufferHandler;
    if (value.trim()) minibufferHistory[minibufferKind].push(value);
    closeMinibuffer();
    if (handler && value.trim()) handler(value);
  });

  function completeCommand() {
    const scheme = globalThis.browseredScheme;
    const typed = minibufferInput.value;
    const matches = [...(scheme?.commands || [])].filter(name => name.startsWith(typed)).sort();
    if (!matches.length) {
      announce("No match");
      return;
    }
    let common = matches[0];
    for (const name of matches) {
      while (!name.startsWith(common)) common = common.slice(0, -1);
    }
    minibufferInput.value = common;
    announce(matches.length === 1 ? "Sole completion" : matches.join("  "), 6000);
  }

  // Scheme messages, output and errors (C-h e).
  const messagesDialog = document.createElement("dialog");
  messagesDialog.setAttribute("aria-label", "Scheme messages");
  const closeMessagesButton = document.createElement("button");
  closeMessagesButton.className = "close";
  closeMessagesButton.textContent = "Close";
  const messagesHeading = document.createElement("h2");
  messagesHeading.textContent = "Messages";
  const messagesList = document.createElement("pre");
  messagesList.className = "messages";
  messagesDialog.append(closeMessagesButton, messagesHeading, messagesList);
  controls.appendChild(messagesDialog);

  function showMessages() {
    const log = globalThis.browseredScheme?.messages || [];
    messagesList.textContent = "";
    for (const entry of log) {
      const line = document.createElement("div");
      line.className = entry.kind;
      line.textContent = entry.text;
      messagesList.appendChild(line);
    }
    if (!log.length) messagesList.textContent = "No messages yet.";
    if (!messagesDialog.open) messagesDialog.showModal();
    messagesList.scrollTop = messagesList.scrollHeight;
    closeMessagesButton.focus();
  }

  function closeMessages() {
    messagesDialog.close();
    if (lastEditor?.isConnected) lastEditor.focus();
  }
  closeMessagesButton.addEventListener("click", closeMessages);
  messagesDialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeMessages();
  });

  (toolbarSlot || document.documentElement).appendChild(controlsHost);

  function announce(message, duration = 2200) {
    status.textContent = message;
    clearTimeout(announce.timer);
    announce.timer = setTimeout(() => {
      status.textContent = "";
    }, duration);
  }

  // A message that stays until replaced, as in the Emacs echo area.
  function showStatus(message) {
    clearTimeout(announce.timer);
    status.textContent = message;
  }

  // Results and Scheme messages stay in the echo area until the next key.
  let echoSticky = false;
  function echo(message) {
    showStatus(message);
    echoSticky = true;
  }

  function closeHelp() {
    helpPrefixPending = false;
    helpDialog.close();
    if (lastEditor?.isConnected) lastEditor.focus();
  }

  function toggleHelp() {
    if (helpDialog.open) {
      closeHelp();
    } else {
      helpDialog.showModal();
      closeHelpButton.focus();
    }
  }

  helpButton.addEventListener("click", toggleHelp);
  closeHelpButton.addEventListener("click", closeHelp);
  helpDialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeHelp();
  });

  const controller = {
    enabled: true,
    // Kills and copies also go to the system clipboard; tests turn this off.
    systemClipboard: true,
    bindings,
    movement,
    toggleHelp,

    // For scheme.js: the editing primitives behind Scheme's buffer API.
    lastEditor: () => lastEditor,
    cursor: editor => getCursorPosition(editor),
    moveCursor: (editor, offset) => moveCursor(editor, offset, false),
    replaceText: (editor, start, end, text) => replaceText(editor, start, end, text),
    mark: editor => getSelectionState(editor).mark,
    setMark: (editor, offset) => {
      const selection = getSelectionState(editor);
      const position = getCursorPosition(editor);
      selection.mark = offset;
      moveCursor(editor, position, false);
    },
    announce: (message, duration) => announce(message, duration),
    echo: message => echo(message),
    killNew: text => {
      killBuffer = text;
      exportKill();
    },
    currentKill: () => killBuffer,

    toggle() {
      this.enabled = !this.enabled;
      if (!this.enabled) {
        if (helpDialog.open) closeHelp();
        if (lastEditor) fieldStates.delete(lastEditor);
        lastKillField = null;
        ctrlXPending = false;
        if (search) endSearch(true);
      }
      controlsHost.hidden = !this.enabled;
      announce(this.enabled ? "Emacs keys enabled" : "Emacs keys disabled");
    }
  };
  globalThis[stateKey] = controller;

  function findTextField(event) {
    return event.composedPath().find(element => {
      if (element instanceof HTMLTextAreaElement) return true;
      if (!(element instanceof HTMLInputElement)) return false;
      return ["text", "search", "url", "tel"].includes(element.type);
    });
  }

  document.addEventListener("focusin", event => {
    const editor = findTextField(event);
    if (editor && editor !== questionField && editor !== minibufferInput) lastEditor = editor;
  }, true);

  // Emacs notation for a key: C- M- s- S- modifiers, then a key name.
  const namedKeys = {
    " ": "SPC", Enter: "RET", Tab: "TAB", Escape: "ESC", Backspace: "DEL",
    Delete: "<delete>", ArrowLeft: "<left>", ArrowRight: "<right>", ArrowUp: "<up>",
    ArrowDown: "<down>", Home: "<home>", End: "<end>", PageUp: "<prior>",
    PageDown: "<next>", Insert: "<insert>"
  };
  function describeKey(event) {
    let base;
    let shiftMatters = false;
    if (/^F\d{1,2}$/.test(event.key)) {
      base = "<" + event.key.toLowerCase() + ">";
      shiftMatters = true;
    } else if (namedKeys[event.key]) {
      base = namedKeys[event.key];
      shiftMatters = true;
    } else if ((event.altKey || event.ctrlKey) && /^Key[A-Z]$/.test(event.code)) {
      // macOS Alt changes event.key; the physical key names the letter.
      base = event.code.slice(3);
      base = event.shiftKey ? base : base.toLowerCase();
    } else if (event.altKey && /^Digit\d$/.test(event.code) && !event.shiftKey) {
      base = event.code.slice(5);
    } else if (Array.from(event.key).length === 1) {
      base = event.key;
    } else {
      return null;
    }
    return (event.ctrlKey ? "C-" : "") + (event.altKey ? "M-" : "") +
      (event.metaKey ? "s-" : "") + (event.shiftKey && shiftMatters ? "S-" : "") + base;
  }

  // Run Scheme; report errors in the status line. Returns the result or null.
  function withScheme(action) {
    const scheme = globalThis.browseredScheme;
    if (!scheme) {
      announce("Scheme is available in the Browsered editor page");
      return null;
    }
    if (!scheme.ready) {
      announce(scheme.failed ? "Scheme failed to start: " + scheme.failed : "Scheme is still loading");
      return null;
    }
    const result = action(scheme);
    if (!result.ok) echo("Error: " + result.error);
    return result;
  }

  function runUserKey(sequence) {
    withScheme(scheme => scheme.runKey(sequence));
  }

  function hasLongerBinding(sequence) {
    const prefix = sequence + " ";
    for (const bound of globalThis.browseredScheme?.keymap || []) {
      if (bound.startsWith(prefix)) return true;
    }
    return false;
  }

  function evalExpression() {
    readMinibuffer("Eval: ", "expression", source => {
      const result = withScheme(scheme => scheme.eval(source));
      if (result?.ok) {
        const output = result.output ? result.output.replace(/\n$/, "") + "\n" : "";
        echo(output + "⇒ " + (result.value ?? ""));
      }
    });
  }

  function executeExtendedCommand() {
    readMinibuffer("M-x ", "command", name => {
      withScheme(scheme => scheme.runCommand(name.trim()));
    });
  }

  function getSelectionState(editor) {
    if (!fieldStates.has(editor)) {
      fieldStates.set(editor, {mark: null, goalColumn: null});
    }
    return fieldStates.get(editor);
  }

  function getCursorPosition(editor) {
    return editor.selectionDirection === "backward"
      ? editor.selectionStart
      : editor.selectionEnd;
  }

  function moveCursor(editor, position, extendSelection) {
    const selection = getSelectionState(editor);
    position = Math.max(0, Math.min(editor.value.length, position));

    if (extendSelection && selection.mark === null) {
      selection.mark = getCursorPosition(editor);
    }
    if (selection.mark === null) {
      editor.setSelectionRange(position, position);
    } else {
      editor.setSelectionRange(
        Math.min(selection.mark, position),
        Math.max(selection.mark, position),
        position < selection.mark ? "backward" : "forward"
      );
    }

    scrollToPosition(editor, position);
  }

  // Logical line navigation is independent of soft wrapping.
  function scrollToPosition(editor, position) {
    if (editor instanceof HTMLTextAreaElement) {
      const style = getComputedStyle(editor);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      const cursorHeight = editor.value.slice(0, position).split("\n").length * lineHeight;
      if (cursorHeight < editor.scrollTop + lineHeight) {
        editor.scrollTop = Math.max(0, cursorHeight - lineHeight);
      } else if (cursorHeight > editor.scrollTop + editor.clientHeight) {
        editor.scrollTop = cursorHeight - editor.clientHeight;
      }
    }
  }

  // Use Chromium's editing commands to keep undo history and input events.
  // A fallback updates the original field when the browser lacks a command.
  function replaceText(editor, start, end, replacement) {
    editor.setSelectionRange(start, end);
    if (start === end && replacement === "") return;

    const previousText = editor.value;
    const commandSucceeded = document.execCommand(
      replacement ? "insertText" : "delete", false, replacement
    );

    if (!commandSucceeded && editor.value === previousText) {
      const inputType = replacement ? "insertText" : "deleteContentForward";
      const beforeInput = new InputEvent("beforeinput", {
        bubbles: true, cancelable: true, inputType, data: replacement || null
      });
      if (!editor.dispatchEvent(beforeInput)) return;

      editor.setRangeText(replacement, start, end, "end");
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType, data: replacement || null
      }));
    }

    const selection = getSelectionState(editor);
    selection.mark = null;
    selection.goalColumn = null;
  }

  function killRange(editor, start, end, direction) {
    if (start === end) {
      lastKillField = null;
      return;
    }

    const previousText = editor.value;
    const removedText = previousText.slice(start, end);
    replaceText(editor, start, end, "");
    if (editor.value === previousText) {
      // A page can cancel an edit through beforeinput.
      lastKillField = null;
      return;
    }
    if (lastKillField === editor && lastKillDirection === direction) {
      killBuffer = direction < 0 ? removedText + killBuffer : killBuffer + removedText;
    } else {
      killBuffer = removedText;
    }
    lastKillField = editor;
    lastKillDirection = direction;
    exportKill();
  }

  // Share kills with other programs through the system clipboard. Keydown is
  // a user gesture, so Chrome allows the write without a prompt.
  let clipboardWrite = Promise.resolve();
  let clipboardWritable = true;
  function exportKill() {
    if (!controller.systemClipboard || !navigator.clipboard?.writeText) return;
    const text = killBuffer;
    clipboardWrite = navigator.clipboard.writeText(text).then(() => {
      lastClipboardText = text;
      clipboardWritable = true;
    }, () => {
      clipboardWritable = false;
    });
  }

  // As in Emacs, yank text copied in another program when it is newer than
  // the last kill; otherwise yank the kill buffer. Chrome may ask once for
  // permission to read the clipboard; refusing keeps the internal buffer.
  function yank(editor, start, end) {
    const insert = () => {
      if (killBuffer) replaceText(editor, start, end, killBuffer);
      else announce("Nothing to yank");
    };
    if (!controller.systemClipboard || !navigator.clipboard?.readText) {
      insert();
      return;
    }
    const before = editor.value;
    clipboardWrite
      .then(() => navigator.clipboard.readText())
      .then(text => {
        if (clipboardWritable && text && text !== lastClipboardText) {
          killBuffer = text;
          lastClipboardText = text;
        }
      }, () => {})
      .then(() => {
        if (!editor.isConnected || editor.value !== before) {
          announce("Text changed while reading the clipboard; yank again");
          return;
        }
        if (document.activeElement !== editor) editor.focus();
        insert();
      });
  }

  // Incremental search. Lowercase queries ignore case, as in Emacs.
  function searchPattern(query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, query === query.toLowerCase() ? "giu" : "gu");
  }

  function findForward(text, query, from) {
    const pattern = searchPattern(query);
    pattern.lastIndex = from;
    const match = pattern.exec(text);
    return match ? {start: match.index, end: match.index + match[0].length} : null;
  }

  function findBackward(text, query, before) {
    const pattern = searchPattern(query);
    let found = null;
    let match;
    while ((match = pattern.exec(text)) && match.index < before) {
      found = {start: match.index, end: match.index + match[0].length};
    }
    return found;
  }

  function startSearch(editor, direction) {
    search = {
      editor, direction, query: "", match: null, failing: false, wrapped: false,
      point: getCursorPosition(editor),
      origin: [editor.selectionStart, editor.selectionEnd, editor.selectionDirection]
    };
    getSelectionState(editor).mark = null;
    showSearch();
  }

  function showSearch() {
    showStatus((search.failing ? "Failing " : "") + (search.wrapped ? "Wrapped " : "") +
      "I-search" + (search.direction < 0 ? " backward" : "") + ": " + search.query);
  }

  // Find the query from the current match; a step moves past that match,
  // and a step after a failure wraps around the document.
  function runSearch(step) {
    const {editor, query, direction, match} = search;
    const text = editor.value;
    if (!query) {
      search.match = null;
      search.failing = false;
      editor.setSelectionRange(search.point, search.point);
      showSearch();
      return;
    }
    const wrap = step && search.failing;
    if (wrap) search.wrapped = true;
    let found;
    if (direction > 0) {
      const from = wrap ? 0 : match ? (step ? match.end : match.start) : search.point;
      found = findForward(text, query, from);
    } else {
      const before = wrap ? text.length + 1 : match ? (step ? match.start : match.start + 1) : search.point;
      found = findBackward(text, query, before);
    }
    if (found) {
      search.match = found;
      search.failing = false;
      editor.setSelectionRange(found.start, found.end, direction < 0 ? "backward" : "forward");
      scrollToPosition(editor, direction < 0 ? found.start : found.end);
    } else {
      search.failing = true;
    }
    showSearch();
  }

  // Accepting leaves the cursor after the match (before it when searching
  // backward); cancelling returns to where the search began.
  function endSearch(accept) {
    const {editor, match, direction, origin, query, point} = search;
    search = null;
    showStatus("");
    if (query) lastSearchQuery = query;
    if (!editor.isConnected) return;
    if (accept && match) {
      const position = direction < 0 ? match.start : match.end;
      editor.setSelectionRange(position, position);
      scrollToPosition(editor, position);
    } else if (!accept) {
      editor.setSelectionRange(...origin);
      scrollToPosition(editor, point);
    }
  }

  // Returns false when the key ends the search and should then run normally.
  function searchKey(event, key) {
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    const consume = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (ctrl && (key === "s" || key === "r")) {
      consume();
      const direction = key === "s" ? 1 : -1;
      if (!search.query) {
        search.direction = direction;
        search.query = lastSearchQuery;
        runSearch(false);
        return true;
      }
      if (direction !== search.direction) {
        search.direction = direction;
        search.failing = false;
      }
      runSearch(true);
      return true;
    }
    if (ctrl && key === "g") {
      consume();
      endSearch(false);
      announce("Quit");
      return true;
    }
    if (plain && (key === "enter" || key === "escape")) {
      consume();
      endSearch(true);
      return true;
    }
    if (plain && key === "backspace") {
      consume();
      search.query = Array.from(search.query).slice(0, -1).join("");
      search.match = null;
      search.wrapped = false;
      runSearch(false);
      return true;
    }
    if (plain && Array.from(event.key).length === 1) {
      consume();
      search.query += event.key;
      runSearch(false);
      return true;
    }
    return false;
  }

  // The key after Ctrl+X. Every key ends the prefix, as in Emacs.
  function ctrlXCommand(event, editor, key) {
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    const selection = getSelectionState(editor);
    event.preventDefault();
    event.stopImmediatePropagation();
    lastKillField = null;
    showStatus("");

    const sequence = "C-x " + describeKey(event);
    const keymap = globalThis.browseredScheme?.keymap;
    if (keymap?.has(sequence)) {
      runUserKey(sequence);
      return;
    }
    if (keymap && hasLongerBinding(sequence)) {
      userPending = sequence;
      showStatus(sequence + "-");
      return;
    }

    const fileCommand = name => {
      const commands = globalThis.browseredFileCommands;
      if (commands?.[name]) commands[name]();
      else announce("Open and save work in the Browsered editor page");
    };
    if (ctrl && key === "f") {
      fileCommand("open");
    } else if (ctrl && key === "s") {
      fileCommand("save");
    } else if (ctrl && key === "w") {
      fileCommand("saveAs");
    } else if (ctrl && key === "x") {
      if (selection.mark === null) {
        announce("No mark set");
      } else {
        const mark = selection.mark;
        selection.mark = getCursorPosition(editor);
        moveCursor(editor, mark, false);
      }
    } else if (plain && key === "h") {
      selection.mark = editor.value.length;
      moveCursor(editor, 0, false);
      announce("Whole document selected");
    } else if (plain && key === "u") {
      selection.mark = null;
      document.execCommand("undo");
    } else if (ctrl && key === "e" && globalThis.browseredScheme) {
      withScheme(scheme => scheme.runCommand("eval-last-sexp"));
    } else if (ctrl && key === "g") {
      announce("Quit");
    } else {
      announce(sequence + " is undefined");
    }
  }

  document.addEventListener("pointerdown", () => {
    if (lastEditor) fieldStates.delete(lastEditor);
    lastKillField = null;
    ctrlXPending = false;
    userPending = null;
    if (search) {
      // The click places the cursor itself.
      search = null;
      showStatus("");
    }
  }, true);

  // Only supported commands in plain text fields are intercepted.
  document.addEventListener("keydown", event => {
    if (!controller.enabled || event.isComposing || event.getModifierState("AltGraph")) return;

    // Help questions keep ordinary typing and do not change the main buffer.
    if (questionDialog.open) {
      if (event.key === "Escape" || (event.ctrlKey && event.key.toLowerCase() === "g")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeQuestionDialog();
      }
      return;
    }

    const key = event.key.toLowerCase();
    const controlPressed = event.ctrlKey && !event.altKey && !event.metaKey;
    const altPressed = event.altKey && !event.ctrlKey && !event.metaKey;
    const editor = findTextField(event);

    // Pressing a modifier by itself neither ends a prefix nor drops the mark.
    if (["Control", "Shift", "Alt", "Meta", "CapsLock", "Fn"].includes(event.key)) return;

    if (echoSticky) {
      echoSticky = false;
      status.textContent = "";
    }

    if (messagesDialog.open) {
      if (key === "escape" || key === "q" || (event.ctrlKey && key === "g")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeMessages();
      }
      return;
    }

    // In the minibuffer, Emacs editing keys work on its input line.
    const inMinibuffer = !minibuffer.hidden && editor === minibufferInput;
    if (!minibuffer.hidden && (key === "escape" || (controlPressed && key === "g"))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMinibuffer();
      announce("Quit");
      return;
    }
    if (inMinibuffer && (key === "tab" || (key === " " && minibufferKind === "command"))
        && !event.ctrlKey && !event.altKey && !event.metaKey && minibufferKind === "command") {
      event.preventDefault();
      event.stopImmediatePropagation();
      completeCommand();
      return;
    }
    if (inMinibuffer && (key === "arrowup" || key === "arrowdown" ||
                         (altPressed && (event.code === "KeyP" || event.code === "KeyN")))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const history = minibufferHistory[minibufferKind];
      const back = key === "arrowup" || event.code === "KeyP";
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (back ? -1 : 1)));
      minibufferInput.value = history[historyIndex] ?? "";
      return;
    }

    if (search) {
      if (search.editor === editor && searchKey(event, key)) return;
      endSearch(true);
    }

    if (ctrlXPending) {
      ctrlXPending = false;
      if (editor && !editor.readOnly && !editor.disabled) {
        ctrlXCommand(event, editor, key);
        return;
      }
    }

    // Ctrl+H is a prefix as well as a direct help command. The following
    // letter is unmodified: G for ChatGPT, R for Claude, K for bindings.
    if (helpPrefixPending && !event.ctrlKey && !event.altKey && !event.metaKey) {
      helpPrefixPending = false;
      if (["g", "r", "k", "e"].includes(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === "e") {
          closeHelp();
          showMessages();
        } else if (key === "k") {
          if (!helpDialog.open) helpDialog.showModal();
          closeHelpButton.focus();
        } else {
          closeHelp();
          openQuestionDialog(key === "g" ? "chatgpt" : "claude");
        }
        return;
      }
    }

    if (helpDialog.open || (editor && controlPressed && key === "h")) {
      if ((controlPressed && ["h", "g"].includes(key)) || key === "escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (editor) lastEditor = editor;
        if (key === "h") {
          toggleHelp();
          helpPrefixPending = helpDialog.open;
        } else {
          closeHelp();
        }
      }
      return;
    }

    if (!editor || editor.disabled || editor.readOnly || editor.selectionStart === null) return;

    // Key bindings made in Scheme (global-set-key) come before built-ins.
    const keymap = globalThis.browseredScheme?.keymap;
    if (keymap?.size && !inMinibuffer) {
      const described = describeKey(event);
      const sequence = described && (userPending ? userPending + " " + described : described);
      if (sequence && keymap.has(sequence)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        userPending = null;
        showStatus("");
        lastEditor = editor;
        runUserKey(sequence);
        return;
      }
      if (sequence && sequence !== "C-x" && sequence !== "C-h" && hasLongerBinding(sequence)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        userPending = sequence;
        showStatus(sequence + "-");
        return;
      }
      if (userPending) {
        event.preventDefault();
        event.stopImmediatePropagation();
        announce(sequence + " is undefined");
        userPending = null;
        return;
      }
    }
    if (!inMinibuffer) lastEditor = editor;
    const selection = getSelectionState(editor);
    const text = editor.value;
    const position = getCursorPosition(editor);
    let command = null;
    let target = null;
    let direction = 1;
    let verticalMove = false;

    if (controlPressed) {
      switch (key) {
        case "a":
          target = movement.lineStart(text, position);
          break;
        case "e":
          target = movement.lineEnd(text, position);
          break;
        case "b":
          target = movement.prevChar(text, position);
          break;
        case "f":
          target = movement.nextChar(text, position);
          break;
        case "p":
        case "n":
          verticalMove = true;
          if (selection.goalColumn === null) {
            selection.goalColumn = position - movement.lineStart(text, position);
          }
          target = movement.vertical(text, position, key === "p" ? -1 : 1, selection.goalColumn);
          break;
        case " ":
        case "@":
          command = "mark";
          break;
        case "g":
          command = "cancel";
          break;
        case "k":
          command = "killLine";
          break;
        case "w":
          command = "killRegion";
          break;
        case "x":
          command = "ctrlX";
          break;
        case "s":
          command = "searchForward";
          break;
        case "r":
          command = "searchBackward";
          break;
        case "y":
          command = "yank";
          break;
        case "d":
          command = "deleteForward";
          break;
        case "/":
        case "_":
          command = "undo";
          break;
        case "l":
          command = "center";
          break;
      }
    } else if (altPressed) {
      // On macOS, Alt may change event.key to an accented character.
      // The physical key code still identifies B, F, D, and W.
      switch (event.code) {
        case "KeyB":
          target = movement.word(text, position, -1);
          break;
        case "KeyF":
          target = movement.word(text, position, 1);
          break;
        case "KeyD":
          command = "killWord";
          break;
        case "KeyW":
          command = "copyRegion";
          break;
        case "KeyX":
          if (globalThis.browseredScheme && !inMinibuffer) command = "executeExtendedCommand";
          break;
        case "Semicolon":
          if (event.shiftKey && globalThis.browseredScheme && !inMinibuffer) command = "evalExpression";
          break;
        case "Backspace":
          command = "killWord";
          direction = -1;
          break;
        case "Comma":
          if (event.shiftKey) target = 0;
          break;
        case "Period":
          if (event.shiftKey) target = text.length;
          break;
      }
    }

    if (target === null && !command) {
      selection.mark = null;
      selection.goalColumn = null;
      lastKillField = null;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (target !== null) {
      if (!verticalMove) selection.goalColumn = null;
      const bufferBoundary = altPressed && ["Comma", "Period"].includes(event.code);
      moveCursor(editor, target, event.shiftKey && !bufferBoundary);
      lastKillField = null;
      return;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (!["killLine", "killRegion", "killWord"].includes(command)) {
      lastKillField = null;
    }

    switch (command) {
      case "mark":
        selection.mark = position;
        announce("Mark set");
        break;
      case "cancel":
        selection.mark = null;
        selection.goalColumn = null;
        editor.setSelectionRange(position, position);
        announce("Quit");
        break;
      case "killLine": {
        const lineEnd = movement.lineEnd(text, position);
        const killEnd = lineEnd === position && position < text.length ? position + 1 : lineEnd;
        killRange(editor, position, killEnd, 1);
        break;
      }
      case "killRegion":
        killRange(editor, start, end, 1);
        break;
      case "killWord": {
        const wordEnd = movement.word(text, position, direction);
        killRange(editor, Math.min(position, wordEnd), Math.max(position, wordEnd), direction);
        break;
      }
      case "copyRegion":
        if (start !== end) {
          killBuffer = text.slice(start, end);
          exportKill();
          selection.mark = null;
          editor.setSelectionRange(position, position);
          announce("Region copied");
        } else {
          announce("No region to copy; set the mark with Ctrl+Space");
        }
        break;
      case "yank":
        yank(editor, start, end);
        break;
      case "executeExtendedCommand":
        executeExtendedCommand();
        break;
      case "evalExpression":
        evalExpression();
        break;
      case "ctrlX":
        ctrlXPending = true;
        showStatus("Ctrl+X-");
        break;
      case "searchForward":
      case "searchBackward":
        startSearch(editor, command === "searchForward" ? 1 : -1);
        break;
      case "deleteForward":
        replaceText(editor, start, start === end ? movement.nextChar(text, end) : end, "");
        break;
      case "undo":
        selection.mark = null;
        document.execCommand("undo");
        break;
      case "center": {
        const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
        const lineNumber = text.slice(0, position).split("\n").length;
        editor.scrollTop = Math.max(0, lineNumber * lineHeight - editor.clientHeight / 2);
        break;
      }
    }
  }, true);

  announce("Emacs keys enabled");
  return true;
})();
