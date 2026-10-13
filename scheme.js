// Browsered's scripting: femtoscheme (WebAssembly) wired to the editor.
// Scheme reaches the page through Module.host(op, jsonArgs); answers go
// back as Scheme datum text. Positions count characters from 1, as in Emacs.
(() => {
  "use strict";
  const keys = globalThis.__browseredEmacsKeys;
  const messages = [];
  const keymap = new Set();          // canonical key sequences bound in Scheme
  const commands = new Set();        // command names, for M-x completion
  let module = null;

  const api = {
    ready: false,
    failed: null,
    keymap,
    commands,
    messages,
    whenReady: null,
    eval: source => run(source),
    runKey: sequence => run("(%run-key " + schemeString(sequence) + ")"),
    runCommand: name => run("(%run-command-named " + schemeString(name) + ")"),
    canonicalKeys
  };
  globalThis.browseredScheme = api;

  // The text field Scheme edits: the last focused field, else the editor.
  function field() {
    const last = keys?.lastEditor?.();
    if (last?.isConnected) return last;
    return document.getElementById("editor");
  }

  function log(text, kind = "message") {
    messages.push({kind, text, time: new Date()});
    if (messages.length > 500) messages.splice(0, messages.length - 500);
  }

  // Scheme string literal for JavaScript text.
  function schemeString(text) {
    return "\"" + String(text).replace(/[\\"]/g, "\\$&")
      .replace(/[\u0000-\u001f\u007f]/g, c => "\\x" + c.charCodeAt(0).toString(16) + ";") + "\"";
  }

  function schemeValue(value) {
    if (value === null || value === undefined || value === false) return "#f";
    if (value === true) return "#t";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "#f";
    if (typeof value === "string") return schemeString(value);
    if (Array.isArray(value)) return "(" + value.map(schemeValue).join(" ") + ")";
    return "#f";
  }

  // Character positions (from 1) <-> UTF-16 offsets in the textarea.
  const hasSurrogates = text => /[\ud800-\udfff]/.test(text);
  function toOffset(text, position) {
    const target = Math.max(1, Math.round(position));
    if (!hasSurrogates(text)) return Math.min(text.length, target - 1);
    let offset = 0;
    for (let n = 1; n < target && offset < text.length; n++) {
      offset += text.codePointAt(offset) > 0xffff ? 2 : 1;
    }
    return offset;
  }
  function toPosition(text, offset) {
    if (!hasSurrogates(text)) return offset + 1;
    let n = 1;
    for (let i = 0; i < offset; n++) i += text.codePointAt(i) > 0xffff ? 2 : 1;
    return n;
  }

  // Each evaluation edits a working copy of the buffer; the net change is
  // applied as one edit at the end, so one undo reverts a whole command.
  let tx = null;
  function begin() {
    if (tx) { tx.depth++; return; }
    const editor = field();
    if (!editor) return;
    tx = {depth: 1, editor, original: editor.value, text: editor.value,
          cursor: keys.cursor(editor), mark: keys.mark(editor)};
  }
  function flush() {
    const {editor, original, text} = tx;
    if (text !== original) {
      let a = 0;
      while (a < original.length && a < text.length && original[a] === text[a]) a++;
      let b = 0;
      while (b < original.length - a && b < text.length - a &&
             original[original.length - 1 - b] === text[text.length - 1 - b]) b++;
      // never split a surrogate pair
      if (a > 0 && /[\ud800-\udbff]/.test(original[a - 1])) a--;
      if (b > 0 && /[\udc00-\udfff]/.test(original[original.length - b])) b--;
      editor.focus();
      keys.replaceText(editor, a, original.length - b, text.slice(a, text.length - b));
    }
    keys.setMark(editor, tx.mark);
    keys.moveCursor(editor, tx.cursor);
    tx.original = editor.value;
    tx.text = editor.value;
  }
  function commit() {
    if (!tx || --tx.depth > 0) return;
    try {
      if (tx.editor.isConnected) flush();
    } finally {
      tx = null;
    }
  }
  function buffer() {
    if (!tx) throw new Error("no buffer");
    return tx;
  }
  function edit(start, end, replacement) {
    const t = buffer();
    t.text = t.text.slice(0, start) + replacement + t.text.slice(end);
    const shift = position => position >= end ? position + replacement.length - (end - start)
      : position > start ? start : position;
    t.cursor = shift(t.cursor);
    if (t.mark !== null) t.mark = shift(t.mark);
  }

  function search(text, needle, from, direction, bound) {
    if (direction > 0) {
      const index = text.indexOf(needle, from);
      return index >= 0 && (bound === null || index + needle.length <= bound) ? index : -1;
    }
    const index = from - needle.length < 0 ? -1 : text.lastIndexOf(needle, from - needle.length);
    return index >= 0 && (bound === null || index >= bound) ? index : -1;
  }

  // Regular expressions are JavaScript's, applied to the buffer text.
  function regexpSearch(text, pattern, flags, from, direction, bound) {
    const re = new RegExp(pattern, flags.replace(/[gy]/g, "") + "g");
    if (direction > 0) {
      re.lastIndex = from;
      const m = re.exec(text);
      if (!m || (bound !== null && m.index + m[0].length > bound)) return null;
      return m;
    }
    let last = null;
    re.lastIndex = bound ?? 0;
    for (let m; (m = re.exec(text)) && m.index + m[0].length <= from;) {
      last = m;
      if (m[0] === "") re.lastIndex++;
    }
    return last;
  }

  // Match data: (start end) for the match and each group, or #f.
  function matchData(text, m) {
    const spans = [[m.index, m.index + m[0].length]];
    if (m.indices) for (let i = 1; i < m.length; i++) spans.push(m.indices[i] || null);
    return spans.map(s => s ? [toPosition(text, s[0]), toPosition(text, s[1])] : false);
  }

  function lineBounds(text, offset) {
    const start = text.lastIndexOf("\n", offset - 1) + 1;
    const end = text.indexOf("\n", offset);
    return [start, end < 0 ? text.length : end];
  }

  // Sexp before the cursor, for C-x C-e: skips strings and comments.
  function lastSexpBounds(text, end) {
    let i = end;
    while (i > 0 && /\s/.test(text[i - 1])) i--;
    const stop = i;
    if (i === 0) return null;
    const closers = {")": "(", "]": "["};
    if (closers[text[i - 1]]) {
      let depth = 0;
      while (i > 0) {
        const c = text[--i];
        if (c === "\"") {
          // back to the opening quote, honoring escapes
          while (i > 0) {
            i--;
            if (text[i] === "\"" && !isEscaped(text, i)) break;
          }
          continue;
        }
        if (c === "\\" ) continue;
        if (closers[c] && !isCharLiteral(text, i)) depth++;
        else if ((c === "(" || c === "[") && !isCharLiteral(text, i)) {
          depth--;
          if (depth === 0) break;
        }
      }
      while (i > 0 && /['`,@#]/.test(text[i - 1])) i--;
      return [i, stop];
    }
    if (text[i - 1] === "\"") {
      i--;
      while (i > 0) {
        i--;
        if (text[i] === "\"" && !isEscaped(text, i)) break;
      }
      return [i, stop];
    }
    while (i > 0 && !/[\s()[\]"';`]/.test(text[i - 1])) i--;
    while (i > 0 && /['`,@]/.test(text[i - 1])) i--;
    return [i, stop];
  }
  function isEscaped(text, i) {
    let n = 0;
    while (i - n - 1 >= 0 && text[i - n - 1] === "\\") n++;
    return n % 2 === 1;
  }
  function isCharLiteral(text, i) { return i >= 2 && text[i - 1] === "\\" && text[i - 2] === "#"; }

  const host = {
    "point": () => toPosition(buffer().text, buffer().cursor),
    "point-max": () => toPosition(buffer().text, buffer().text.length),
    "goto-char": position => {
      const t = buffer();
      t.cursor = toOffset(t.text, position);
      return true;
    },
    "buffer-substring": (start, end) => {
      const text = buffer().text;
      return text.slice(toOffset(text, start), toOffset(text, end));
    },
    "insert": text => {
      const t = buffer();
      const at = t.cursor;
      edit(at, at, text);
      t.cursor = at + text.length;
      return true;
    },
    "delete-region": (start, end) => {
      const text = buffer().text;
      edit(toOffset(text, start), toOffset(text, end), "");
      return true;
    },
    "mark": () => {
      const t = buffer();
      return t.mark === null ? false : toPosition(t.text, t.mark);
    },
    "set-mark": position => {
      const t = buffer();
      t.mark = position === false ? null : toOffset(t.text, position);
      return true;
    },
    "line-bounds": position => {
      const text = buffer().text;
      const [start, end] = lineBounds(text, toOffset(text, position));
      return [toPosition(text, start), toPosition(text, end)];
    },
    "forward-line": n => {
      const t = buffer();
      const text = t.text;
      let [start] = lineBounds(text, t.cursor);
      let moved = 0;
      while (n > 0 && moved < n) {
        const next = text.indexOf("\n", start);
        if (next < 0) { start = text.length; break; }
        start = next + 1;
        moved++;
      }
      while (n < 0 && moved > n && start > 0) {
        start = text.lastIndexOf("\n", start - 2) + 1;
        moved--;
      }
      t.cursor = start;
      return n - moved;
    },
    "line-number": position => {
      const text = buffer().text;
      return text.slice(0, toOffset(text, position)).split("\n").length;
    },
    "search": (needle, direction, bound) => {
      const t = buffer();
      const text = t.text;
      const index = search(text, needle, t.cursor, direction,
                           bound === false ? null : toOffset(text, bound));
      return index < 0 ? false
        : [toPosition(text, index), toPosition(text, index + needle.length)];
    },
    "re-search": (pattern, direction, bound, flags) => {
      const t = buffer();
      const text = t.text;
      const m = regexpSearch(text, pattern, (flags || "") + "d", t.cursor, direction,
                             bound === false ? null : toOffset(text, bound));
      return m ? matchData(text, m) : false;
    },
    "looking-at": (pattern, flags) => {
      const t = buffer();
      const text = t.text;
      const re = new RegExp(pattern, (flags || "").replace(/[gy]/g, "") + "yd");
      re.lastIndex = t.cursor;
      const m = re.exec(text);
      return m ? matchData(text, m) : false;
    },
    // On strings, positions are 0-based character indexes, as in substring.
    "string-match": (pattern, string, start, flags) => {
      const chars = Array.from(string);
      const prefix = chars.slice(0, start).join("").length;
      const re = new RegExp(pattern, (flags || "").replace(/[gy]/g, "") + "gd");
      re.lastIndex = prefix;
      const m = re.exec(string);
      if (!m) return false;
      const index = offset => Array.from(string.slice(0, offset)).length;
      const spans = [[m.index, m.index + m[0].length]];
      for (let i = 1; i < m.length; i++) spans.push(m.indices[i] || null);
      return spans.map(s => s ? [index(s[0]), index(s[1])] : false);
    },
    "regexp-replace": (pattern, string, replacement, all, flags) =>
      string.replace(new RegExp(pattern, (flags || "").replace(/[gy]/g, "") + (all ? "g" : "")),
                     replacement),
    "last-sexp": () => {
      const t = buffer();
      const text = t.text;
      const bounds = lastSexpBounds(text, t.cursor);
      return bounds ? [toPosition(text, bounds[0]), toPosition(text, bounds[1])] : false;
    },
    "message": text => {
      log(text);
      keys.echo(text);
      return true;
    },
    "read-string": (prompt, initial) => {
      const answer = window.prompt(prompt, initial || "");
      return answer === null ? false : answer;
    },
    "y-or-n-p": prompt => window.confirm(prompt),
    "bind-key": sequence => {
      const canonical = canonicalKeys(sequence);
      keymap.add(canonical);
      return canonical;
    },
    "unbind-key": sequence => keymap.delete(canonicalKeys(sequence)),
    "add-command": name => { commands.add(name); return true; },
    "kill-new": text => { keys.killNew(text); return true; },
    "current-kill": () => keys.currentKill(),
    "undo": () => {
      const t = buffer();
      flush();
      t.editor.focus();
      document.execCommand("undo");
      t.original = t.text = t.editor.value;
      t.cursor = keys.cursor(t.editor);
      t.mark = keys.mark(t.editor);
      return true;
    },
    "file": (command) => {
      const files = globalThis.browseredFileCommands;
      if (command === "name") return files?.name?.() || false;
      if (!files?.[command]) throw new Error("file commands work in the Browsered editor page");
      files[command]();
      return true;
    },
    "reload-init": () => { loadInit(); return true; },
    "choose-init": () => { chooseInit(); return true; },
    "store-init": text => storeInit(text === false ? null : text),
    "native-helper": () => nativeHelper
  };

  // Emacs key syntax: modifiers C- M- s- S- in that order; named keys
  // SPC RET TAB ESC DEL and <name>.
  function canonicalKeys(sequence) {
    return String(sequence).trim().split(/\s+/).map(key => {
      const mods = {C: false, M: false, s: false, S: false};
      let rest = key;
      while (/^[CMsSA]-./.test(rest)) {
        const m = rest[0] === "A" ? "M" : rest[0];
        mods[m] = true;
        rest = rest.slice(2);
      }
      if (/^<.+>$/.test(rest)) rest = rest.toLowerCase();
      else if (/^(spc|ret|tab|esc|del)$/i.test(rest)) rest = rest.toUpperCase();
      return (mods.C ? "C-" : "") + (mods.M ? "M-" : "") + (mods.s ? "s-" : "") +
        (mods.S ? "S-" : "") + rest;
    }).join(" ");
  }

  function run(source) {
    if (!api.ready) {
      return {ok: false, output: "", value: null,
              error: api.failed || "Scheme is still loading"};
    }
    let result;
    begin();
    try {
      result = JSON.parse(module.ccall("fs_eval", "string", ["string"], [source]));
    } finally {
      commit();
    }
    if (result.output) log(result.output, "output");
    if (!result.ok) log(result.error, "error");
    return result;
  }

  // init.scm: Browsered.app's helper serves the file next to the app.
  // Elsewhere (Edge, GitHub Pages) the init file chosen with M-x
  // choose-init-file or M-x use-buffer-as-init is kept in browser
  // storage; without one, the site's example init.scm is used.
  const nativeHelper = location.origin === "http://127.0.0.1:8766";
  const initKey = "browsered-init-scm";
  function storedInit() {
    try { return localStorage.getItem(initKey); } catch { return null; }
  }
  function storeInit(text) {
    try {
      if (text === null) localStorage.removeItem(initKey);
      else localStorage.setItem(initKey, text);
      return true;
    } catch {
      return false;
    }
  }
  function evalInit(text, origin) {
    const result = run(text);
    if (!result.ok) keys.echo(origin + ": " + result.error);
    return result.ok;
  }
  function loadInit() {
    const stored = nativeHelper ? null : storedInit();
    if (stored !== null) {
      evalInit(stored, "init file");
      return Promise.resolve();
    }
    return fetch("init.scm", {cache: "no-store"})
      .then(response => response.ok ? response.text() : null)
      .then(text => { if (text !== null) evalInit(text, "init.scm"); })
      .catch(() => {});   // opened as a file: no init file
  }
  function chooseInit() {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".scm,.ss,.txt,text/plain";
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      if (!file) return;
      const text = await file.text();
      if (!storeInit(text)) {
        keys.echo("Browser storage is unavailable; the init file applies to this session only");
      }
      if (evalInit(text, file.name)) keys.echo("Loaded " + file.name + "; it will load each time Browsered opens");
    });
    picker.click();
  }

  async function editorSource() {
    const script = document.getElementById("browsered-editor-scm");
    if (!script) return "";
    if (script.textContent.trim()) return script.textContent;
    const response = await fetch(script.getAttribute("src"));
    return response.text();
  }

  api.whenReady = (async () => {
    if (typeof createFemtoscheme !== "function") {
      api.failed = "femtoscheme.js is not loaded";
      return false;
    }
    try {
      module = await createFemtoscheme({
        print: text => log(text, "output"),
        printErr: text => log(text, "error")
      });
      module.host = (op, payload) => {
        const handler = host[op];
        if (!handler) throw new Error("unknown host operation " + op);
        return schemeValue(handler(...JSON.parse(payload)));
      };
      const status = module.ccall("fs_start", "number", [], []);
      if (status !== 0) throw new Error("femtoscheme did not start (" + status + ")");
      api.ready = true;
      const loaded = run(await editorSource());
      if (!loaded.ok) throw new Error("editor.scm: " + loaded.error);
      await loadInit();
      return true;
    } catch (error) {
      api.ready = false;
      api.failed = String(error.message || error);
      log(api.failed, "error");
      return false;
    }
  })();
})();
