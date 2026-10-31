// browsered.js -- the page's half of the screen layer (src/web.c).
//
// The editor core, in WebAssembly, draws a grid of character cells;
// paint() puts them on the canvas.  Keys and the mouse become the bytes a
// terminal would send (as src/gui.c makes them from SDL events), queued
// for screen_getch(), which waits on nextByte().

Module.browsered = (function () {
  "use strict";
  var canvas = null, ctx = null;
  var family = "Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";
  var points = 15, cellW = 9, cellH = 18, ascent = 14, dpr = 1, pad = 4, naturalW = 9;
  var nRows = 34, nCols = 100;
  var queue = [], waiting = null;
  var last = null, lastCursor = -1;
  var focused = true, optionIsMeta = true, finished = false;
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  function push(b) {
    if (waiting) { var w = waiting; waiting = null; w(b); }
    else queue.push(b);
  }
  function pushString(s) {
    var bytes = new TextEncoder().encode(s);
    for (var i = 0; i < bytes.length; i++) push(bytes[i]);
  }

  function measure() {
    ctx.font = points * dpr + "px " + family;
    var m = ctx.measureText("MMMMMMMMMM");
    naturalW = m.width / 10;
    cellW = Math.max(1, Math.round(m.width / 10));
    cellH = Math.round(points * dpr * 1.3);
    ascent = Math.round(points * dpr * 1.0);
  }

  function layout() {
    dpr = window.devicePixelRatio || 1;
    pad = Math.round(4 * dpr);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    measure();
    nCols = Math.max(20, Math.floor((canvas.width - 2 * pad) / cellW));
    nRows = Math.max(4, Math.floor((canvas.height - 2 * pad) / cellH));
    last = null;
  }

  function css(c) { return "#" + (c & 0xFFFFFF | 0x1000000).toString(16).slice(1); }

  function fontFor(style) {
    return (style & 2 ? "italic " : "") + (style & 1 ? "bold " : "") +
      points * dpr + "px " + family;
  }

  function cell(h, i, x, y, invert, cursorColor) {
    var cp = h[i], fg = h[i + 1], bg = h[i + 2], style = h[i + 3];
    if (invert) { fg = bg; bg = cursorColor; }
    ctx.fillStyle = css(bg);
    ctx.fillRect(x, y, cellW, cellH);
    if (cp && cp !== 32) {
      ctx.font = fontFor(style);
      ctx.fillStyle = css(fg);
      var ch = String.fromCodePoint(cp);
      var w = ctx.measureText(ch).width;
      if (w > cellW * 1.25) {           // squeeze wide glyphs into the cell
        ctx.save();
        ctx.translate(x, 0);
        ctx.scale(cellW / w, 1);
        ctx.fillText(ch, 0, y + ascent);
        ctx.restore();
      } else {
        ctx.fillText(ch, x, y + ascent);
      }
    }
    if (style & 4) ctx.fillRect(x, y + cellH - Math.max(1, dpr), cellW, Math.max(1, dpr));
  }

  function paint(ptr, rows, cols, crow, ccol, bg, cursorColor) {
    var h = HEAP32.subarray(ptr >> 2, (ptr >> 2) + rows * cols * 4);
    var full = !last || last.length !== h.length;
    if (full) {
      ctx.fillStyle = css(bg);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    var cursor = crow * cols + ccol;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var k = r * cols + c, i = k * 4;
        if (!full && k !== cursor && k !== lastCursor &&
            last[i] === h[i] && last[i + 1] === h[i + 1] &&
            last[i + 2] === h[i + 2] && last[i + 3] === h[i + 3]) continue;
        var x = pad + c * cellW, y = pad + r * cellH;
        cell(h, i, x, y, k === cursor && focused, cursorColor);
        if (k === cursor && !focused) {
          ctx.strokeStyle = css(cursorColor);
          ctx.lineWidth = dpr;
          ctx.strokeRect(x + dpr / 2, y + dpr / 2, cellW - dpr, cellH - dpr);
        }
      }
    }
    last = h.slice();
    lastCursor = cursor;

  }

  // Keys, as gui.c's key_down() ------------------------------------------

  var lastKey = { seq: null, time: 0 };   // the Tab or RET just pressed, to replay
  var special = {
    ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D",
    Home: "\x1bOH", End: "\x1bOF", PageUp: "\x1b[5~", PageDown: "\x1b[6~",
    Insert: "\x1b[2~", Delete: "\x1b[3~", Backspace: "\x7f", Enter: "\r",
    Tab: "\t", Escape: "\x1b", F1: "\x1bOP"
  };
  var shiftedPunct = { "`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%",
    "6": "^", "7": "&", "8": "*", "9": "(", "0": ")", "-": "_", "=": "+", "[": "{",
    "]": "}", "\\": "|", ";": ":", "'": "\"", ",": "<", ".": ">", "/": "?" };

  // the key's character on a US layout, from event.code (for Ctrl and Meta)
  function baseKey(e) {
    var code = e.code || "";
    if (/^Key[A-Z]$/.test(code)) return code.charAt(3).toLowerCase();
    if (/^Digit[0-9]$/.test(code)) return code.charAt(5);
    var map = { Space: " ", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
      Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
      Backquote: "`" };
    if (code in map) return map[code];
    return e.key && e.key.length === 1 ? e.key.toLowerCase() : null;
  }

  function fontSize(delta) {
    if (points + delta < 6) return;
    points += delta;
    resized();
  }

  function keydown(e) {
    if (finished) return;
    if (e.target.closest && e.target.closest("#writing-mode, #writing-toggle")) return;
    var ctrl = e.ctrlKey, shift = e.shiftKey;
    var altGr = e.getModifierState && e.getModifierState("AltGraph");
    var meta = e.altKey && !altGr && optionIsMeta;
    var cmd = isMac && e.metaKey;
    var k = baseKey(e);

    if (e.isComposing || e.key === "Dead" || e.key === "Process") return;
    // Shortcuts bubble to document even after focus leaves #keys. Restore
    // the text receiver too, otherwise prompts open but typed text is lost.
    // Dialogs and the optional writing editor own their own input fields.
    if (keysField && document.activeElement !== keysField && document.activeElement !== layer &&
        !document.querySelector(".api-key-dialog, #writing-mode"))
      focusKeys();
    if (cmd) {
      switch (k) {
      case "v": return;                 // the paste event follows
      case "c": e.preventDefault(); pushString("\x1bw"); return;
      case "x": e.preventDefault(); push(0x17); return;
      case "z": e.preventDefault(); if (shift) pushString("\x1b\x1f"); else push(0x15); return;
      case "s": e.preventDefault(); pushString("\x18\x13"); return;
      case "=": e.preventDefault(); fontSize(1); return;
      case "-": e.preventDefault(); fontSize(-1); return;
      default: return;                  // the browser's own Cmd keys
      }
    }
    if (e.key === "Insert" && shift) return;   // paste event
    if (ctrl && !meta && (k === "=" || k === "-")) {
      e.preventDefault(); fontSize(k === "=" ? 1 : -1); return;
    }
    if (!isMac && ctrl && shift && k === "v") return;  // paste event
    var seq = special[e.key];
    lastKey = { seq: (e.key === "Tab" || e.key === "Enter") && !ctrl && !meta ? seq : null,
                time: Date.now() };
    if (seq) {
      e.preventDefault();
      if (meta || (ctrl && e.key === "Backspace")) push(0x1b);
      pushString(seq);
      return;
    }
    if (ctrl && !altGr) {
      var b = -1;
      if (k && k >= "a" && k <= "z") b = k.charCodeAt(0) - 96;
      else if (k === " " || k === "2" || k === "@") b = 0;
      else if (k === "[") b = 0x1b;
      else if (k === "\\") b = 0x1c;
      else if (k === "]") b = 0x1d;
      else if (k === "6") b = 0x1e;
      else if (k === "-" || k === "/" || k === "_") b = 0x1f;
      if (b >= 0) {
        e.preventDefault();
        if (meta) push(0x1b);
        push(b);
      }
      return;
    }
    if (meta && k) {
      var ch = k;
      if (shift && ch >= "a" && ch <= "z") ch = ch.toUpperCase();
      else if (shift && shiftedPunct[ch]) ch = shiftedPunct[ch];
      e.preventDefault();
      push(0x1b);
      pushString(ch);
      return;
    }
    // Printable text is left to the hidden text field (#keys), which
    // receives it composed: accents and ~ typed with dead keys (ABNT2,
    // US International, a Mac's Option-n), and input methods.
  }

  var keysField = null;
  function takeTyped() {
    if (finished) { keysField.value = ""; return; }
    var text = keysField.value;
    keysField.value = "";
    if (text) pushString(text.replace(/\r\n?/g, "\n"));
  }

  // The text Grammarly sees -----------------------------------------------
  //
  // Grammarly reads only text fields, never the canvas.  When the selected
  // window holds prose, src/web-layer.c sends, after every redisplay, the
  // window's rows and its text; textLayer lays a transparent text field
  // with that text exactly over them.  The field takes the keys, but the
  // editor stays the only editor: what is typed goes to the editor, as from
  // #keys, and the field shows the editor's text again.  A change that no
  // key made (Grammarly's correction) goes to the editor as
  // (web-layer-edit ...) of web.scm, which applies it only if the buffer
  // still holds the old text.  Anything unexpected removes the field.

  var layer = null, layerInfo = null, layerShadow = "";
  var layerTyping = false, layerComposing = false, layerSent = 0, layerTaken = 0;

  function focusKeys() {
    var f = layer && !finished ? layer : keysField;
    if (f) f.focus({ preventScroll: true });
  }

  function removeLayer() {
    if (!layer) return;
    var had = document.activeElement === layer;
    layer.remove(); layer = null; layerInfo = null;
    if (had && keysField) keysField.focus({ preventScroll: true });
  }

  // the UTF-16 index of byte OFFSET of TEXT
  function indexOfByte(text, offset) {
    var bytes = 0, i = 0;
    while (i < text.length && bytes < offset) {
      var c = text.codePointAt(i);
      bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
      i += c >= 0x10000 ? 2 : 1;
    }
    return i;
  }

  function placeCaret() {
    var at = indexOfByte(layerShadow, layerInfo.point);
    if (layer.selectionStart !== at || layer.selectionEnd !== at) layer.setSelectionRange(at, at);
    layer.scrollTop = 0; layer.scrollLeft = 0;
  }

  function makeLayer() {
    var t = document.createElement("textarea");
    t.id = "text-layer";
    t.setAttribute("aria-label", "The window's text, for Grammarly");
    // no data-gramm, no data-enable-grammarly: any data-gramm, even "true",
    // turns Grammarly off for the field (seen in Chrome, 2026-10-30)
    t.addEventListener("keydown", function (e) {
      var meta = e.altKey && optionIsMeta && !(e.getModifierState && e.getModifierState("AltGraph"));
      if (!e.ctrlKey && !e.metaKey && !meta &&
          (e.key.length === 1 || e.key === "Dead" || e.key === "Process")) layerTyping = true;
    });
    t.addEventListener("keyup", function () { if (!layerComposing) layerTyping = false; });
    t.addEventListener("compositionstart", function () { layerComposing = true; layerTyping = true; });
    t.addEventListener("compositionend", function () { layerComposing = false; takeLayerInput(); });
    t.addEventListener("input", function (e) { if (!e.isComposing && !layerComposing) takeLayerInput(); });
    t.addEventListener("mousedown", function (e) {   // a click is the editor's (and Grammarly's)
      if (e.button === 0) { buttonDown = true; mouse(0, e, false); }
    });
    t.addEventListener("wheel", wheel, { passive: false });
    document.body.appendChild(t);
    return t;
  }

  function takeLayerInput() {
    var now = layer.value, old = layerShadow, typed = layerTyping;
    layerTyping = false;
    if (now === old) return;
    var p = 0, n = Math.min(now.length, old.length);
    while (p < n && now.charCodeAt(p) === old.charCodeAt(p)) p++;
    if (p > 0 && now.charCodeAt(p - 1) >= 0xD800 && now.charCodeAt(p - 1) <= 0xDBFF) p--;
    var q = 0;
    while (q < n - p && now.charCodeAt(now.length - 1 - q) === old.charCodeAt(old.length - 1 - q)) q++;
    if (q > 0 && now.charCodeAt(now.length - q) >= 0xDC00 && now.charCodeAt(now.length - q) <= 0xDFFF) q--;
    var added = now.slice(p, now.length - q), removed = old.slice(p, old.length - q);
    // text put in at the cursor (dictation, the emoji picker, an input
    // method) is typed too: the editor puts it there, or gives it to the
    // minibuffer when that is asking
    if (!removed && p === indexOfByte(old, layerInfo.point)) typed = true;
    if (typed) {                      // a key: the editor's, as from #keys
      layer.value = old; placeCaret();
      if (added) pushString(added.replace(/\r\n?/g, "\n"));
      return;
    }
    layerShadow = now;                // Grammarly's: the editor checks and applies it
    layerSent++;
    runScheme("(web-layer-edit " + schemeString(layerInfo.buffer) + " " + layerInfo.page + " " +
              lengthBytesUTF8(old.slice(0, p)) + " " + schemeString(removed) + " " +
              schemeString(added.replace(/\r\n?/g, "\n")) + ")");
  }

  function textLayer(json) {
    var info = null;
    try { info = json ? JSON.parse(json) : null; } catch (e) { info = null; }
    try {
      if (!info || finished || document.querySelector("#writing-mode")) { removeLayer(); return; }
      if (!layer) layer = makeLayer();
      var st = layer.style;
      st.left = pad / dpr + "px";
      st.top = (pad + info.top * cellH) / dpr + "px";
      st.width = nCols * cellW / dpr + 0.5 + "px";   // the editor wraps at nCols
      st.height = info.rows * cellH / dpr + "px";
      st.font = points + "px " + family;
      st.lineHeight = cellH / dpr + "px";
      st.letterSpacing = (cellW - naturalW) / dpr + "px";   // the canvas's cells exactly
      layerInfo = info;
      // while the editor has not yet applied every correction sent, or a
      // key is being composed, the field keeps what it has
      if (layerSent !== layerTaken || layerComposing) return;
      if (layer.value !== info.text) layer.value = info.text;
      layerShadow = info.text;
      placeCaret();
      if (document.activeElement === keysField || document.activeElement === document.body) layer.focus({ preventScroll: true });
    } catch (e) {
      try { removeLayer(); } catch (e2) { layer = null; }
    }
  }

  // Mouse, as gui.c's push_mouse() ----------------------------------------

  var lastRow = -1, lastCol = -1, buttonDown = false;
  function mouse(button, e, release) {
    var rect = canvas.getBoundingClientRect();
    var col = Math.floor(((e.clientX - rect.left) * dpr - pad) / cellW);
    var row = Math.floor(((e.clientY - rect.top) * dpr - pad) / cellH);
    col = Math.max(0, Math.min(nCols - 1, col));
    row = Math.max(0, Math.min(nRows - 1, row));
    if ((button & 32) && row === lastRow && col === lastCol) return;
    lastRow = row; lastCol = col;
    pushString("\x1b[<" + button + ";" + (col + 1) + ";" + (row + 1) + (release ? "m" : "M"));
  }

  var wheelRest = 0;
  function wheel(e) {
    e.preventDefault();
    var lines = e.deltaMode === 1 ? e.deltaY : e.deltaY / 40;
    wheelRest += lines;
    var notches = Math.trunc(wheelRest);
    wheelRest -= notches;
    notches = Math.max(-5, Math.min(5, notches));
    for (var i = 0; i < Math.abs(notches); i++) mouse(notches < 0 ? 64 : 65, e, false);
  }

  // Clipboard -------------------------------------------------------------

  function pasteText(text) {
    if (finished) return;
    if (!text) return;
    text = text.replace(/\r\n?/g, "\n");
    var n = lengthBytesUTF8(text) + 1, p = _malloc(n);
    stringToUTF8(text, p, n);
    _web_set_scrap(p);
    push(0x19);                         // C-y
  }

  function resized() {
    var oldRows = nRows, oldCols = nCols;
    layout();
    if (nRows !== oldRows || nCols !== oldCols) push(0x9A);
    else push(0x0C);                    // C-l: redraw at the new size
  }

  // Scheme from the page, run by the editor between keys (src/web.c) --------

  var evals = [];
  function runScheme(expr) { evals.push(expr); push(-2); }
  function schemeString(s) { return JSON.stringify(s); }   // a Scheme string literal

  // Files ---------------------------------------------------------------
  //
  // The editor sees an ordinary file system (Emscripten's).  HOME,
  // /home/web_user, is kept in the browser (IndexedDB), with
  // ~/.browsered/init.scm and the files saved there.
  //
  // A folder of the computer (C-c o) appears under HOME where the user
  // says, ~/csand say, so paths and completion are those of the computer.
  // It is not copied: its listing is read in the background, a file is
  // read when the editor opens it, and a file saved there is written back
  // to the computer.  Such folders are left out of the browser's storage,
  // and the browser remembers them (with their permission) for next time.
  // Chrome and Edge only: other browsers do not give a page folders.

  var HOME = "/home/web_user";
  var folders = [];               // {path, handle}
  var files = {};                 // path -> FileSystemFileHandle
  var syncTimer = null, syncing = false;
  var listedPaths = {};

  function syncHome() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { FS.syncfs(false, function () {}); }, 300);
  }

  function mkdirs(path) {
    var parts = path.split("/").filter(Boolean), at = "";
    parts.forEach(function (p) {
      at += "/" + p;
      try { FS.mkdir(at); } catch (e) { /* exists */ }
    });
  }

  // A folder directly in HOME whose name does not begin with a dot is a
  // folder of the computer: the editor makes no others (its own settings
  // are in ~/.browsered, and files dropped or saved in HOME are files).
  // Such folders are never kept in the browser's storage.
  function isComputerFolder(path) {
    if (isFolderRoot(path)) return true;
    if (path.indexOf(HOME + "/") !== 0) return false;
    var name = path.slice(HOME.length + 1);
    if (!name || name.indexOf("/") >= 0 || name.charAt(0) === ".") return false;
    try { return FS.isDir(FS.stat(path).mode); } catch (e) { return false; }
  }

  // Earlier Browsereds kept copies (some empty) of such folders in the
  // browser's storage, where they hid the real folders: remove them.
  function removeTree(path) {
    var st;
    try { st = FS.stat(path); } catch (e) { return; }
    if (FS.isDir(st.mode)) {
      FS.readdir(path).forEach(function (n) {
        if (n !== "." && n !== "..") removeTree(path + "/" + n);
      });
      try { FS.rmdir(path); } catch (e) { /* in use */ }
    } else {
      try { FS.unlink(path); } catch (e) { /* gone */ }
    }
  }
  function forgetOldCopies() {
    var removed = false;
    FS.readdir(HOME).forEach(function (n) {
      var p = HOME + "/" + n;
      if (n !== "." && n !== ".." && !isFolderRoot(p) && isComputerFolder(p)) {
        removeTree(p);
        removed = true;
      }
    });
    if (removed) syncHome();
  }

  function isFolderRoot(path) {
    return folders.some(function (f) { return f.path === path; });
  }

  // the folder of PATH among the opened ones, with the path inside it
  function folderOf(path) {
    for (var i = 0; i < folders.length; i++)
      if (path.indexOf(folders[i].path + "/") === 0)
        return { folder: folders[i], rest: path.slice(folders[i].path.length + 1) };
    return null;
  }

  // Saving is enabled by default. M-x forbid-saving explicitly protects a
  // folder or single file for this visit; M-x allow-saving restores writes.
  var allowed = {};               // explicit folder/file overrides: true or false
  function computerTarget(path) {
    if (typeof path !== "string") return null;
    var f = folderOf(path);
    if (f) return f.folder.path;
    if (isFolderRoot(path)) return path;
    if (files[path]) return path;  // a single file taken from the computer
    return null;
  }
  function mayWrite(path) {
    var key = computerTarget(path);
    return !key || allowed[key] !== false;
  }
  var refusedSave = null;
  function refuseWrite(path) {
    if (refusedSave === path) return;
    refusedSave = path;
    var key = computerTarget(path);
    runScheme("(web-read-only-message " + schemeString(path) + " " + schemeString(key) + ")");
    setTimeout(function () { refusedSave = null; }, 1000);
  }

  // A file of the computer, listed but not read: its node has the right
  // size and time, and its contents arrive when it is opened (loadLazy).
  var unlisted = {};              // path -> handle of a folder not listed yet
  var listing = false;            // making nodes for a listing: no writes back
  // Read the text of a listed file now, in the background, so that the
  // editor finds it in memory when it opens the file.  Files above 8 MB
  // wait until they are opened (loadLazy).
  async function preload(path) {
    var node;
    try { node = FS.lookupPath(path).node; } catch (e) { return; }
    var file = node.browseredFile;
    if (!file || file.size > 8 * 1024 * 1024) return;
    var data;
    try { data = new Uint8Array(await file.arrayBuffer()); }
    catch (e) {                                   // changed since it was listed
      try { file = await files[path].getFile(); data = new Uint8Array(await file.arrayBuffer()); }
      catch (e2) { readError = path + ": " + (e2.name || "") + " " + (e2.message || e2); return; }
    }
    if (!node.browseredFile) return;              // opened or written meanwhile
    node.contents = data;
    node.usedBytes = data.length;
    node.timestamp = file.lastModified;
    node.browseredTime = file.lastModified;
    delete node.browseredFile;
  }
  var readError = "";

  async function listDirectory(dir, path, queue) {
    if (!unlisted[path] && listedPaths[path]) return;
    delete unlisted[path];
    listedPaths[path] = true;
    mkdirs(path);
    var toRead = [];
    for await (var entry of dir.values()) {
      var where = path + "/" + entry.name;
      if (entry.kind === "directory") {
        if (entry.name.charAt(0) === "." || entry.name === "node_modules") continue;
        mkdirs(where);
        unlisted[where] = entry;
        queue.push({ dir: entry, path: where });
      } else {
        var file = await entry.getFile(), node;
        files[where] = entry;
        // the node is made by the page, not saved by the editor: nothing
        // may be written back to the computer for it (an earlier version
        // did, and emptied every file it listed)
        listing = true;
        try {
          try { FS.unlink(where); } catch (e) { /* new */ }
          FS.writeFile(where, new Uint8Array(0));
        } finally { listing = false; }
        node = FS.lookupPath(where).node;
        node.usedBytes = file.size;
        node.timestamp = file.lastModified;
        node.browseredFile = file;
        toRead.push(where);
      }
    }
    for (var k = 0; k < toRead.length; k++) await preload(toRead[k]);
  }

  // only the first level: a subfolder is listed when the editor goes into it
  async function mountFolder(handle, path) {
    folders = folders.filter(function (f) { return f.path !== path; });
    folders.push({ path: path, handle: handle });
    Object.keys(listedPaths).forEach(function (p) {
      if (p === path || p.indexOf(path + "/") === 0) delete listedPaths[p];
    });
    await listDirectory(handle, path, []);   // its subfolders: when they are used
    return path;
  }

  // read a listed file now, synchronously (a blob: URL read by a
  // synchronous request), because the editor is opening it
  function loadLazy(node) {
    var file = node.browseredFile;
    if (file.remotePath) {
      var request = new XMLHttpRequest();
      request.open("POST","/files",false);
      request.setRequestHeader("Content-Type","application/x-browsered-files");
      request.overrideMimeType("text/plain; charset=x-user-defined");
      request.send("read\n" + file.remotePath + "\n");
      if (request.status !== 200) { readError = request.responseText; return false; }
      var bytes = new Uint8Array(request.responseText.length);
      for (var k = 0; k < bytes.length; k++) bytes[k] = request.responseText.charCodeAt(k) & 255;
      node.contents = bytes; node.usedBytes = bytes.length; node.browseredTime = file.lastModified;
      delete node.browseredFile;
      return true;
    }
    var url = URL.createObjectURL(file);
    try {
      var x = new XMLHttpRequest();
      x.open("GET", url, false);
      x.overrideMimeType("text/plain; charset=x-user-defined");
      x.send(null);
      // a File read after the file changed on the computer gives an error,
      // or nothing: never take that for the text
      if ((x.status !== 200 && x.status !== 0) || x.responseText.length !== file.size) {
        readError = "status " + x.status + ", " + x.responseText.length + " of " + file.size + " bytes";
        return false;
      }
      var text = x.responseText, bytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xFF;
      node.contents = bytes;
      node.usedBytes = bytes.length;
      node.browseredTime = file.lastModified;
      delete node.browseredFile;
      return true;
    } catch (e) {
      readError = (e.name || "") + " " + (e.message || e);
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // the file changed on the computer since it was listed: list it again
  async function relist(path, node) {
    var handle = files[path];
    if (!handle) return;
    var file = await handle.getFile();
    node.browseredFile = file;
    node.usedBytes = file.size;
    node.timestamp = file.lastModified;
  }

  // Back in the window: the files listed or read before may have changed
  // on the computer meanwhile.  Those that did are read again when next
  // opened (a buffer already open keeps its text, as in Emacs).
  var refreshing = false;
  async function refreshFiles() {
    if (refreshing) return;
    refreshing = true;
    try {
      for (var path in files) {
        var node;
        try { node = FS.lookupPath(path).node; } catch (e) { continue; }
        var known = node.browseredFile ? node.browseredFile.lastModified : node.browseredTime;
        var file;
        try { file = await files[path].getFile(); } catch (e) { continue; }
        if (known === undefined || file.lastModified === known) continue;
        node.contents = new Uint8Array(0);
        node.browseredFile = file;
        node.usedBytes = file.size;
        node.timestamp = file.lastModified;
      }
    } finally { refreshing = false; }
  }

  async function writeBack(path) {
    if (!mayWrite(path)) throw new Error("saving is off for " + path.replace(HOME, "~"));
    var data = FS.readFile(path), handle = files[path];
    // never empty a file of the computer: an empty save is refused
    if (data.length === 0 && handle) {
      var now = await handle.getFile();
      if (now.size > 0) throw new Error("refused to write an empty " + path.replace(HOME, "~") +
                                        " over " + now.size + " bytes");
    }
    if (!handle) {
      var f = folderOf(path);
      if (!f) return;
      var dir = f.folder.handle, parts = f.rest.split("/");
      for (var i = 0; i < parts.length - 1; i++)
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      handle = files[path] = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    }
    var w = await handle.createWritable();
    await w.write(data);
    await w.close();
  }

  // The editor touched a path of the computer that the page has not got
  // yet: ~/csand/... before csand was given, or a folder not listed yet.
  // Get it, then press the same Tab or RET again.  The browser lets a page
  // ask for a folder only right after a key (a "user gesture"): the Tab.
  var fetching = false, refused = {};
  function replay(seq) {
    fetching = false;
    if (seq && lastKey.seq === seq) pushString(seq);
  }

  // A path under HOME that the page lacks: PATH (absolute), whose last
  // part may be a beginning of a name (TAB).  Lists the subfolders on the
  // way inside a given folder; takes up a folder given before; or asks the
  // browser's folder dialog (allowed right after a key).  True if
  // something changed, so that the TAB or RET may be tried again.
  async function ensure(path, partial) {
    var mounted = folders.filter(function(f) { return path === f.path || path.indexOf(f.path+"/")===0; })
      .sort(function(a,b) {return b.path.length-a.path.length;})[0];
    if (mounted) {
      var at = mounted.path, changed = false;
      if (unlisted[at]) {await listDirectory(unlisted[at],at,[]); changed=true;}
      var parts = path.slice(at.length+1).split("/");
      for (var k=0; k<parts.length-1; k++) {
        at += "/"+parts[k];
        if (unlisted[at]) {await listDirectory(unlisted[at],at,[]);changed=true;}
      }
      return changed;
    }
    if (path.indexOf(HOME + "/") !== 0) return false;
    var parts = path.slice(HOME.length + 1).split("/"), first = parts[0];
    if (!first || first.charAt(0) === "." || refused[first]) return false;
    var root = HOME + "/" + first;
    // a missing file directly in HOME (a new file, a picture to be saved)
    // is no folder of the computer: ask for nothing
    if (!partial && parts.length < 2) return false;
    if (isFolderRoot(root)) {
      var at = root, changed = false;
      for (var i = 1; i < parts.length - (partial ? 1 : 0); i++) {
        at += "/" + parts[i];
        if (unlisted[at]) { await listDirectory(unlisted[at], at, []); changed = true; }
      }
      return changed;
    }
    var single = partial && parts.length === 1;      // ~/csa: a beginning of a name
    if (!single && FS.analyzePath(root).exists) return false;   // the browser's own
    if (single && FS.readdir(HOME).some(function (n) { return n.indexOf(first) === 0; }))
      return false;
    var known = waitingFolders.find(function (f) {
      return single ? f.path.indexOf(HOME + "/" + first) === 0 : f.path === root;
    });
    if (known) {
      var state = await known.handle.queryPermission({ mode: "readwrite" });
      if (state !== "granted") state = await known.handle.requestPermission({ mode: "readwrite" });
      if (state !== "granted") { refused[first] = true; return false; }
      waitingFolders = waitingFolders.filter(function (f) { return f !== known; });
      await mountFolder(known.handle, known.path);
      return true;
    }
    if (!window.showDirectoryPicker && !localFilesAvailable()) {
      notice("Start Browsered.command and open its local page to access folders in this browser.");
      setTimeout(function () { notice(null); }, 5000);
      return false;
    }
    notice("Browsered may read only folders you give it: choose your folder " +
           (single ? first + "…" : first));
    var handle;
    try {
      handle = localFilesAvailable() ? await chooseLocalFolder("~/" + first) :
        await window.showDirectoryPicker({ id: "browsered", mode: "readwrite" });
      if (!handle) { refused[first] = true; return false; }
    }
    catch (e) { refused[first] = true; return false; }
    finally { notice(null); }
    var where = single ? HOME + "/" + handle.name : root;
    if (FS.analyzePath(where).exists && !isFolderRoot(where)) return false;
    await mountFolder(handle, where);
    rememberFolder(where, handle);
    return true;
  }

  // RET on a path the page lacks (the C core found nothing): get it
  function missing(path) {
    if (fetching || syncing || lastKey.seq !== "\r" || Date.now() - lastKey.time > 3000) return;
    if (typeof path !== "string" || (path.indexOf(HOME + "/") !== 0 && !folderOf(path))) return;
    fetching = true;
    // the C core has opened an empty buffer for the file it did not find:
    // once the folder is there, the file is read into that buffer
    ensure(path, false).then(function (changed) {
      fetching = false;
      if (changed) runScheme("(web-reload-file " + schemeString(path) + " #t)");
    }, function () { fetching = false; });
  }

  // TAB found nothing for TYPED (~/csa, ~/csand/sub/x)
  async function askFolder(typed) {
    var path = typed.indexOf("~/")===0 ? HOME+typed.slice(1) : typed;
    if (path.charAt(0)!=="/") return null;
    return (await ensure(path,true)) ? "changed" : null;
  }

  function notice(text) {
    var n = document.getElementById("notice");
    n.textContent = text || "";
    n.hidden = !text;
  }

  var tries = {};
  function readFailure(path) {
    var n = document.getElementById("notice");
    n.textContent = "Browsered could not read " + path.replace(HOME, "~") +
      " from the computer (" + readError + "). Please send this message to the developer.";
    n.className = "failure";
    n.hidden = false;
    setTimeout(function () { n.hidden = true; }, 30000);
  }

  function watchFiles() {
    var lookupPath = FS.lookupPath;
    FS.lookupPath = function (path) {
      try { return lookupPath.apply(this, arguments); }
      catch (e) { missing(path); throw e; }
    };
    var readdirFirst = FS.readdir;
    FS.readdir = function (path) {
      var handle = unlisted[path];
      if (handle && !fetching && !syncing && lastKey.seq === "\r" && Date.now() - lastKey.time < 3000) {
        var seq = lastKey.seq;
        fetching = true;
        listDirectory(handle, path, []).then(function () { replay(seq); }, function () { replay(null); });
      }
      return readdirFirst.apply(this, arguments);
    };
    // opening a listed file reads it from the computer
    var open = FS.open;
    FS.open = function (path, flags) {
      if (typeof path === "string" && !listing) {
        var wf = typeof flags === "string" ? FS.modeStringToFlags(flags) : flags;
        var abs = path.charAt(0) === "/" ? path : PATH.join2(FS.cwd(), path);
        if ((wf & 3) !== 0 && !mayWrite(abs)) {     // O_WRONLY or O_RDWR
          refuseWrite(abs);
          throw new FS.ErrnoError(2);               // EACCES
        }
      }
      if (typeof path === "string") {
        var node = null;
        try { node = FS.lookupPath(path, { follow: true }).node; } catch (e) { /* new file */ }
        if (node && node.browseredFile) {
          var f = typeof flags === "string" ? FS.modeStringToFlags(flags) : flags;
          if (f & 512) {                          // O_TRUNC: the old text is not needed
            node.contents = new Uint8Array(0);
            node.usedBytes = 0;
            delete node.browseredFile;
          } else if (!loadLazy(node)) {
            var where = FS.getPath(node);
            // read it again from the computer, then show it in its buffer;
            // a second failure is shown, not tried again
            tries[where] = (tries[where] || 0) + 1;
            if (tries[where] > 1) {
              tries[where] = 0;
              readFailure(where);
            } else {
              relist(where, node).then(function () { return preload(where); }).then(function () {
                runScheme("(web-reload-file " + schemeString(where) + ")");
              }, function () { readFailure(where); });
            }
            throw new FS.ErrnoError(29);          // EIO
          }
        }
      }
      return open.apply(this, arguments);
    };
    // every file the editor writes: kept in the browser, or on the computer
    var close = FS.close;
    FS.close = function (stream) {
      var writing = (stream.flags & 3) !== 0 && !listing, path = stream.path;
      var r = close.apply(this, arguments);
      if (writing && path) {
        if (computerTarget(path) && !mayWrite(path)) { /* refused at open; never written */ }
        else if (files[path] || folderOf(path))
          writeBack(path).catch(function (e) {
            runScheme("(message " + schemeString("Not written to the computer: " + e.message) + ")");
          });
        else if (path.indexOf(HOME + "/") === 0) syncHome();
      }
      return r;
    };
    // the browser's storage keeps HOME without the computer's folders
    var readdir = FS.readdir;
    FS.readdir = function (path) {
      var names = readdir.apply(this, arguments);
      if (!syncing) return names;
      return names.filter(function (n) { return !isComputerFolder(PATH.join2(path, n)); });
    };
    var syncfs = FS.syncfs;
    FS.syncfs = function (populate, callback) {
      syncing = true;
      return syncfs.call(this, populate, function (err) { syncing = false; callback(err); });
    };
  }

  function download(path) {
    var data = FS.readFile(path), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data]));
    a.download = path.split("/").pop();
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }

  // files from the computer without a folder: copied into HOME
  async function takeFiles(list) {
    var opened = null;
    for (var i = 0; i < list.length; i++) {
      var item = list[i], file = item.getFile ? await item.getFile() : item;
      var where = HOME + "/" + file.name;
      FS.writeFile(where, new Uint8Array(await file.arrayBuffer()));
      if (item.getFile) files[where] = item;
      opened = opened || where;
    }
    syncHome();
    return opened;
  }

  // The folders, remembered in the browser ----------------------------------

  function folderStore(mode, work) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("browsered-folders", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("folders", { keyPath: "path" }); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var tx, r;
        try { tx = req.result.transaction("folders", mode); r = work(tx.objectStore("folders")); }
        catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(r && r.result); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  }

  var waitingFolders = [];        // remembered folders that need a click or a key
  // the folders given before: taken up when a path needs them (ensure)
  async function restoreFolders() {
    forgetOldCopies();
    var saved;
    try { saved = await folderStore("readonly", function (s) { return s.getAll(); }); }
    catch (e) { return; }
    (saved || []).forEach(function (f) {
      if (f && f.remotePath && localFilesAvailable()) f.handle = localHandle(f.remotePath,{name:f.name,kind:"directory"});
      if (f && f.handle && f.path) waitingFolders.push(f);
    });
  }


  function localFilesAvailable() {
    return !window.showDirectoryPicker && location.protocol === "http:" && location.hostname === "127.0.0.1";
  }
  async function localFileRequest(op, path, data) {
    if (/[\r\n]/.test(path)) throw new Error("Newlines are not supported in local paths.");
    var response = await fetch("/files", {method:"POST", headers:{"Content-Type":"application/x-browsered-files"},
      body: new Blob([op + "\n" + path + "\n", data || new Uint8Array(0)])});
    if (!response.ok) throw new Error(await response.text());
    return response;
  }
  function localHandle(path, info) {
    var handle = {remotePath:path, name:info.name, kind:info.kind,
      queryPermission: async function () { return "granted"; }, requestPermission: async function () { return "granted"; }};
    handle.getFile = async function () {
      var current = await (await localFileRequest("stat",path)).json();
      return {name:current.name, size:current.size, lastModified:current.mtime, remotePath:path,
        arrayBuffer: async function () { return (await localFileRequest("read",path)).arrayBuffer(); }};
    };
    handle.values = async function* () {
      var entries = await (await localFileRequest("list",path)).json();
      for (var entry of entries) yield localHandle(path.replace(/\/$/,"") + "/" + entry.name,entry);
    };
    handle.getDirectoryHandle = async function (name, opts) {
      var child = path.replace(/\/$/,"") + "/" + name;
      if (opts && opts.create) await localFileRequest("mkdir",child);
      var meta = await (await localFileRequest("stat",child)).json();
      if (meta.kind !== "directory") throw new Error("Not a folder.");
      return localHandle(child,meta);
    };
    handle.getFileHandle = async function (name) { return localHandle(path.replace(/\/$/,"") + "/" + name,{name:name,kind:"file"}); };
    handle.createWritable = async function () {
      var data;
      return {write:async function (value) {data=value;},close:async function () {await localFileRequest("write",path,data);}};
    };
    return handle;
  }
  async function chooseLocalFolder(initial) {
    var path = window.prompt("Folder on your computer (absolute path or ~/):",initial || "~/");
    if (!path) return null;
    path = path.replace(/\/$/,"") || "/";
    var info = await (await localFileRequest("stat",path)).json();
    if (info.kind !== "directory") throw new Error("Choose a folder.");
    return localHandle(path,info);
  }
  var picked = null;
  async function pickFolder() {
    if (localFilesAvailable()) picked = await chooseLocalFolder("~/");
    else if (window.showDirectoryPicker) picked = await window.showDirectoryPicker({ mode: "readwrite" });
    else return null;
    if (!picked) return null;
    return picked.name;
  }

  // "~/csand" -> /home/web_user/csand, under HOME and not HOME itself
  function homePath(where) {
    where = where.trim().replace(/\/+$/, "");
    if (where === "~" || where.indexOf("~/") === 0) where = HOME + where.slice(1);
    if (where.indexOf(HOME + "/") !== 0) return null;
    return where;
  }

  function rememberFolder(path, handle) {
    var record = handle.remotePath ? {path:path, remotePath:handle.remotePath, name:handle.name} : {path:path,handle:handle};
    folderStore("readwrite", function (s) { return s.put(record); }).catch(function () {});
  }

  async function mountPicked(where) {
    var path = homePath(where);
    if (!picked || !path) return null;
    if (FS.analyzePath(path).exists && !isFolderRoot(path) && FS.readdir(path).length > 2)
      return null;                                // not over the browser's own files
    var handle = picked;
    picked = null;
    await mountFolder(handle, path);
    rememberFolder(path, handle);
    return path;
  }

  async function openFile() {
    if (localFilesAvailable()) {
      var path = window.prompt("File on your computer (absolute path or ~/):", "~/");
      if (!path) return null;
      var info = await (await localFileRequest("stat",path)).json();
      if (info.kind !== "file") throw new Error("Choose a file.");
      return takeFiles([localHandle(path,info)]);
    }
    if (window.showOpenFilePicker) {
      var handles = await window.showOpenFilePicker({ multiple: true });
      return takeFiles(handles);
    }
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.onchange = function () { takeFiles(input.files).then(resolve, function () { resolve(null); }); };
      input.click();
    });
  }

  // TTFY (C-c f): PDF pages rendered in the page by pdf.js (Mozilla's
  // renderer, bundled in Browsered.html), 144 dpi as Schememax renders
  // them with Quartz, then sent as images to Claude or ChatGPT.
  var ttfyImages = [];
  function pdfLibrary() {
    var lib = window.pdfjsLib;
    if (!lib) throw new Error("pdf.js is missing from this Browsered.html");
    if (!lib.GlobalWorkerOptions.workerSrc) {
      var src = document.getElementById("pdf-worker").textContent;
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    }
    return lib;
  }
  async function renderPdf(json) {
    var req = JSON.parse(json), lib = pdfLibrary();
    var data = FS.readFile(req.path);              // a file of the computer is read here
    var pdf = await lib.getDocument({ data: data }).promise;
    var first = 1, last = pdf.numPages, m;
    if ((m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(req.range || ""))) {
      first = +m[1]; last = m[2] ? +m[2] : first;
    } else if ((req.range || "").trim() !== "") {
      throw new Error("pages must be all, N or N-M");
    }
    if (first < 1 || last > pdf.numPages || first > last)
      throw new Error("the PDF has pages 1-" + pdf.numPages);
    if (last - first + 1 > 32) throw new Error("at most 32 pages at a time");
    ttfyImages = [];
    for (var n = first; n <= last; n++) {
      var page = await pdf.getPage(n), viewport = page.getViewport({ scale: 2 });
      var canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
      ttfyImages.push(canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""));
    }
    return JSON.stringify({ first: first, last: last, count: ttfyImages.length });
  }
  // Subscription-backed Codex is available only through the local launcher.
  // There is deliberately no paid API fallback, even when a key is saved.
  async function codexAsk(req, images) {
    if (location.protocol !== "http:" || location.hostname !== "127.0.0.1")
      return JSON.stringify({ error: "Start Browsered.command (or make run) to use your Codex allowance. Open the local page it launches; an HTML file cannot run Codex by itself." });
    try {
      var body = (req.model || "") + "\n" + images.length + "\n" +
        images.map(function (s) { return s + "\n"; }).join("") + req.prompt;
      var response = await fetch("/codex", { method: "POST",
        headers: { "content-type": "application/x-browsered-codex" }, body: body });
      var text = await response.text();
      return JSON.stringify(response.ok ? { answer: text } : { error: text || "The local Codex request failed." });
    } catch (e) {
      return JSON.stringify({ error: "Cannot reach the local Codex bridge. Keep Browsered.command running. " + e.message });
    }
  }

  // Claude Code with the Claude subscription, through the same local
  // launcher (tools/codex-bridge.c, /claude); the API key is not used.
  function localBridge() { return location.protocol === "http:" && location.hostname === "127.0.0.1"; }
  async function claudeBridge() {
    if (!localBridge()) return null;
    try {
      var r = await fetch("/claude/status"), text = r.ok ? await r.text() : "";
      var mark = "Browsered Claude bridge: ";
      return text.indexOf(mark) === 0 ? text.slice(mark.length) : null;   // not some other server
    }
    catch (e) { return null; }
  }
  async function claudeAsk(req) {
    if (!localBridge())
      return JSON.stringify({ error: "Start Browsered.command to use your Claude subscription (or M-x set-claude-key for the API)." });
    try {
      var enc = new TextEncoder();
      var body = (req.model || "") + "\n" + enc.encode(req.system).length + "\n" +
        enc.encode(req.question).length + "\n" + req.system + req.question + req.context;
      var response = await fetch("/claude", { method: "POST",
        headers: { "content-type": "application/x-browsered-claude" }, body: body });
      var text = await response.text();
      return JSON.stringify(response.ok ? { answer: text } : { error: text || "The local Claude request failed." });
    } catch (e) {
      return JSON.stringify({ error: "Cannot reach the local bridge. Keep Browsered.command running. " + e.message });
    }
  }

  // {provider, key, model, system, prompt}: the prompt with the rendered pages
  async function ttfyAsk(json) {
    var req = JSON.parse(json), answer, body;
    if (req.provider === "codex") {
      var result = JSON.parse(await codexAsk(req, ttfyImages));
      return result.error ? "TTFY failed: " + result.error : result.answer;
    }
    if (req.provider === "claude") {
      var content = ttfyImages.map(function (b64) {
        return { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } };
      });
      content.push({ type: "text", text: req.prompt });
      answer = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
        headers: { "x-api-key": req.key, "anthropic-version": "2023-06-01",
                   "anthropic-dangerous-direct-browser-access": "true",
                   "content-type": "application/json" },
        body: JSON.stringify({ model: req.model, max_tokens: 32000, system: req.system,
                               messages: [{ role: "user", content: content }] }) });
      body = await answer.json();
      if (body.type === "error") return "TTFY failed: " + body.error.message;
      return body.content.filter(function (b) { return b.type === "text"; })
                         .map(function (b) { return b.text; }).join("");
    }
    return "TTFY failed: unknown provider.";
  }

  // irene-dixe (C-c p): Schememax's plot and table window, compiled to
  // WebAssembly as a module of its own (build/irene-dixe.js, with
  // src/web-sdl.c); each run gets the files it names, and gives back the
  // pictures it saved.
  function ireneDixe(json) {
    var req = JSON.parse(json), args = req.args, err = "";
    var inputs = args.filter(function (a) {
      try { return FS.isFile(FS.stat(a).mode); } catch (e) { return false; }
    });
    var outputs = args.filter(function (a) { return a.charAt(0) === "/" && inputs.indexOf(a) < 0; });
    var finished = new Promise(function (resolve) {
      var mod = null;
      createIreneDixe({
        arguments: args,
        print: function () {},
        printErr: function (t) { err += t + "\n"; },
        preRun: [function (M) {
          mod = M;
          inputs.forEach(function (p) {
            var dir = p.slice(0, p.lastIndexOf("/")), at = "";
            dir.split("/").filter(Boolean).forEach(function (d) {
              at += "/" + d; try { M.FS.mkdir(at); } catch (e) { /* exists */ }
            });
            M.FS.writeFile(p, FS.readFile(p));
          });
          outputs.forEach(function (p) {
            var dir = p.slice(0, p.lastIndexOf("/")), at = "";
            dir.split("/").filter(Boolean).forEach(function (d) {
              at += "/" + d; try { M.FS.mkdir(at); } catch (e) { /* exists */ }
            });
          });
        }],
        onIreneExit: function (code) {
          outputs.forEach(function (p) {
            var data;
            try { data = mod.FS.readFile(p); } catch (e) { return; }
            try { FS.writeFile(p, data); }
            catch (e) { err += "could not save " + p + "\n"; code = code || 1; }
          });
          resolve({ status: code, err: err });
        }
      }).catch(function (e) { resolve({ status: -1, err: String(e && e.message || e) }); });
    });
    if (!req.wait) {
      finished.then(function (r) {
        if (r.status) runScheme("(message " + schemeString("irene-dixe: " + r.err.trim()) + ")");
      });
      return "started";
    }
    return finished.then(function (r) { return JSON.stringify(r); });
  }

  // A real password field supports the browser's normal paste behavior.
  // The editor's line reader ignores the C-y used for buffer pastes.
  function apiKeyPrompt(label) {
    return new Promise(function (resolve) {
      var dialog = document.createElement("section");
      dialog.className = "api-key-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      var form = document.createElement("form");
      var title = document.createElement("label");
      title.textContent = label;
      var input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.id = "api-key-input";
      title.htmlFor = input.id;
      var save = document.createElement("button");
      save.type = "submit"; save.textContent = "Save key";
      var cancel = document.createElement("button");
      cancel.type = "button"; cancel.textContent = "Cancel";
      form.append(title, input, save, cancel);
      dialog.append(form); document.body.append(dialog);
      function finish(value) {
        input.value = "";
        dialog.remove(); focusKeys();
        resolve(value);
      }
      form.addEventListener("submit", function (e) { e.preventDefault(); finish(input.value.trim()); });
      cancel.addEventListener("click", function () { finish(null); });
      dialog.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); finish(null); }
      });
      dialog.addEventListener("paste", function (e) { e.stopPropagation(); });
      input.focus();
    });
  }

  // Grammarly needs actual editable DOM text, rather than painted cells.
  // Work on a draft, then return the result to the current Scheme buffer.
  // Colours for the writing view (it cannot use the canvas editor's
  // highlighter: that is Scheme, waiting meanwhile).  Colours only, no
  // bold or italic, so that every character keeps the textarea's width.
  function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function hl(kind, s) { return '<span class="hl-' + kind + '">' + escapeHtml(s) + "</span>"; }
  var latexSections = /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|title|caption)\*?$/;
  function highlightLatex(text) {
    var out = "", last = 0, m;
    var re = /(%.*$)|(\\(?:begin|end)\s*\{[^}\n]*\})|(\\[a-zA-Z@]+\*?)|(\\.)|(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\n])*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))|([{}\[\]])/gm;
    while ((m = re.exec(text))) {
      out += escapeHtml(text.slice(last, m.index));
      out += m[1] ? hl("comment", m[0]) : m[2] ? hl("env", m[0]) :
             m[3] ? hl(latexSections.test(m[0]) ? "section" : "command", m[0]) :
             m[4] ? hl("escape", m[0]) : m[5] ? hl("math", m[0]) : hl("brace", m[0]);
      last = re.lastIndex;
      if (m[0] === "") re.lastIndex++;
    }
    return out + escapeHtml(text.slice(last));
  }
  function highlightMarkdownInline(line) {
    var out = "", last = 0, m;
    var re = /(`[^`]*`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(\[[^\]\n]*\]\([^)\n]*\))|(\|)/g;
    while ((m = re.exec(line))) {
      out += escapeHtml(line.slice(last, m.index));
      out += hl(m[1] ? "code" : m[2] ? "strong" : m[3] ? "em" : m[4] ? "link" : "pipe", m[0]);
      last = re.lastIndex;
    }
    return out + escapeHtml(line.slice(last));
  }
  function highlightMarkdown(text) {
    var fence = false;
    return text.split("\n").map(function (line) {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return hl("code", line); }
      if (fence) return hl("code", line);
      if (/^#{1,6}\s/.test(line)) return hl("heading", line);
      if (/^\s*>/.test(line)) return hl("quote", line);
      var list = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(line);
      if (list) return escapeHtml(list[1]) + hl("list", list[2]) + escapeHtml(list[3]) + highlightMarkdownInline(line.slice(list[0].length));
      return highlightMarkdownInline(line);
    }).join("\n");
  }
  function writingLanguage(name) {
    name = String(name || "").replace(/<\d+>$/, "");
    if (/\.(tex|ltx|sty|cls|bib)$/i.test(name)) return highlightLatex;
    if (/\.(md|markdown)$/i.test(name)) return highlightMarkdown;
    return null;
  }

  function writingMode(json) {
    var req = JSON.parse(json);
    return new Promise(function (resolve) {
      var panel = document.createElement("section"); panel.id = "writing-mode";
      if (req.persistent) { panel.className = "document-default"; document.body.classList.add("document-active"); }
      var bar = document.createElement("header");
      // the status line's first item, as the canvas editor's: the file's
      // name (a button: its details on the message line), * when changed,
      // and the cursor's line
      var label = document.createElement("button"); label.type = "button"; label.className = "writing-name";
      label.setAttribute("aria-label", "File: " + req.name);
      var apply = document.createElement("button"); apply.textContent = "Apply and return";
      var save = document.createElement("button"); save.textContent = "Save and return";
      var cancel = document.createElement("button"); cancel.textContent = "Cancel";
      bar.append(label);
      if (req.persistent) {
        var open = document.createElement("button"); open.textContent = "Open";
        var chat = document.createElement("button"); chat.textContent = "ChatGPT";
        var advanced = document.createElement("button"); advanced.textContent = "Advanced editor";
        var quit = document.createElement("button"); quit.textContent = "Quit";
        save.textContent = "Save";
        bar.append(open, save, chat, advanced, quit);
        open.onclick = async function () {
          try { var path = await openFile(); if (path) finish("open", {path:path}); }
          catch (e) { if (e.name !== "AbortError") help.textContent = e.message; }
        };
        chat.onclick = function () {
          var box = document.createElement("section"); box.className = "document-question";
          var title = document.createElement("label"); title.textContent = "What would you like ChatGPT to do?";
          var question = document.createElement("textarea"); question.setAttribute("aria-label", "ChatGPT request");
          var send = document.createElement("button"); send.textContent = "Send to ChatGPT";
          var close = document.createElement("button"); close.textContent = "Cancel request";
          title.append(question); box.append(title, send, close); panel.append(box); question.focus();
          send.onclick = function () { if (question.value.trim()) finish("codex", {request:question.value}); };
          close.onclick = function () { box.remove(); text.focus(); };
        };
        advanced.onclick = function () { finish("advanced"); };
        quit.onclick = function () { finish("quit"); };
      } else bar.append(apply, save, cancel);
      var text = document.createElement("textarea");
      text.id = req.persistent ? "editor" : "writing-text";
      text.setAttribute("aria-label", req.persistent ? "Document" : "Document for writing and Grammarly");
      text.placeholder = "Write here";
      text.wrap = "off";
      text.spellcheck = true;
      if (!req.persistent) { text.setAttribute("data-enable-grammarly", "true"); text.setAttribute("data-gramm", "true"); }
      text.value = req.text;
      var help = document.createElement("p");
      // the message line, as Emacs's: empty, unless there is something to
      // say ("Saved."); the keys are in README.md and C-h, not here
      help.className = "writing-message"; help.setAttribute("role", "status");
      help.textContent = req.persistent ? (req.status || "") : "Apply returns your changes to the editor; Save also saves the file.";
      var keyHelp = "Emacs keys: C-s/C-r or M-s/M-r search, C-x C-s save, C-x C-f open, C-x b buffer, C-c d the advanced editor, C-a/e, C-b/f, C-p/n, M-b/f, M-</>, C-v/M-v, C-k/y, C-SPC, C-w, M-w, M-d, C-/.";
      help.title = keyHelp;   // shown only on pointing at the line
      // a coloured copy of the text behind it: the textarea's own letters
      // are transparent, its cursor, selection and Grammarly's marks are not
      var area = text, colorize = writingLanguage(req.name);
      if (colorize) {
        area = document.createElement("div"); area.className = "writing-area";
        var colors = document.createElement("pre"); colors.className = "writing-colors"; colors.setAttribute("aria-hidden", "true");
        area.append(colors, text); text.classList.add("colored");
        var colorFrame = 0;
        var followScroll = function () { colors.scrollTop = text.scrollTop; colors.scrollLeft = text.scrollLeft; };
        var paintColors = function () { colorFrame = 0; colors.innerHTML = colorize(text.value) + "\n "; followScroll(); };
        text.addEventListener("input", function () { if (!colorFrame) colorFrame = requestAnimationFrame(paintColors); });
        text.addEventListener("scroll", followScroll);
        paintColors();
      }
      panel.append(bar, area, help);
      var statusFrame = 0;
      function drawStatus() {
        statusFrame = 0;
        var line = 1, upto = text.selectionStart, v = text.value;
        for (var i = v.indexOf("\n"); i >= 0 && i < upto; i = v.indexOf("\n", i + 1)) line++;
        var changed = req.modified || v !== req.text;
        label.textContent = (changed ? "*" : "") + req.name + ", L. " + line;
      }
      function updateStatus() { if (!statusFrame) statusFrame = requestAnimationFrame(drawStatus); }
      drawStatus();
      for (var statusEvent of ["input", "keyup", "mouseup", "focus"]) text.addEventListener(statusEvent, updateStatus);
      document.addEventListener("selectionchange", updateStatus);
      label.addEventListener("click", function () { finish("file-info"); });
      // a message stays until the next key or click, as in Emacs
      function clearMessage(e) {
        if (e && e.type === "keydown" && ["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        if (help.textContent) help.textContent = "";
      }
      text.addEventListener("keydown", clearMessage); text.addEventListener("mousedown", clearMessage);
      if (req.reply) {
        var response = document.createElement("section"); response.className = "document-answer";
        var responseTitle = document.createElement("strong"); responseTitle.textContent = "ChatGPT";
        var answer = document.createElement("pre"); answer.textContent = req.reply;
        var dismiss = document.createElement("button"); dismiss.textContent = "Close answer";
        dismiss.onclick = function () { response.remove(); text.focus(); };
        response.append(responseTitle, dismiss, answer); panel.append(response);
      }
      document.body.append(panel);
      // A steady, high-contrast caret supplements the browser's thin caret.
      // It is purely visual: Grammarly still edits the original textarea.
      var writingCaret=document.createElement("span");writingCaret.className="writing-caret";writingCaret.setAttribute("aria-hidden","true");panel.append(writingCaret);
      var caretFrame=0;
      function caretMetrics(){
        var style=getComputedStyle(text),rect=text.getBoundingClientRect(),before=text.value.slice(0,head()).split("\n");
        var measure=document.createElement("canvas").getContext("2d");measure.font=style.font;
        var column=0,expanded="";for(var ch of before[before.length-1]){if(ch==="\t"){var n=8-column%8;expanded+=" ".repeat(n);column+=n;}else{expanded+=ch;column++;}}
        return {rect:rect,x:measure.measureText(expanded).width,y:(before.length-1)*parseFloat(style.lineHeight),height:parseFloat(style.lineHeight),left:parseFloat(style.paddingLeft)+parseFloat(style.borderLeftWidth),top:parseFloat(style.paddingTop)+parseFloat(style.borderTopWidth),right:parseFloat(style.paddingRight),bottom:parseFloat(style.paddingBottom)};
      }
      function drawWritingCaret(){
        caretFrame=0;
        if(!panel.isConnected || document.activeElement!==text || text.selectionStart!==text.selectionEnd){writingCaret.hidden=true;return;}
        var m=caretMetrics(),x=m.rect.left+m.left+m.x-text.scrollLeft,y=m.rect.top+m.top+m.y-text.scrollTop;
        writingCaret.hidden=x<m.rect.left || x>m.rect.left+text.clientWidth || y<m.rect.top || y+m.height>m.rect.top+text.clientHeight;
        writingCaret.style.left=x+"px";writingCaret.style.top=y+"px";writingCaret.style.height=m.height+"px";
      }
      function updateWritingCaret(){if(!caretFrame)caretFrame=requestAnimationFrame(drawWritingCaret);}
      function revealWritingCaret(){
        var m=caretMetrics(),width=text.clientWidth-m.left-m.right,height=text.clientHeight-m.top-m.bottom;
        if(m.y<text.scrollTop)text.scrollTop=m.y;
        else if(m.y+m.height>text.scrollTop+height)text.scrollTop=m.y+m.height-height;
        if(m.x<text.scrollLeft)text.scrollLeft=m.x;
        else if(m.x>text.scrollLeft+width-8)text.scrollLeft=m.x-width+8;
        updateWritingCaret();
      }
      document.addEventListener("selectionchange",updateWritingCaret);
      window.addEventListener("resize",updateWritingCaret);
      for(var caretEvent of ["input","keyup","scroll","focus","blur"])text.addEventListener(caretEvent,updateWritingCaret);
      var caretResize=typeof ResizeObserver!=="undefined"?new ResizeObserver(updateWritingCaret):null;if(caretResize)caretResize.observe(text);
      updateWritingCaret();
      var cursor = new TextDecoder().decode(new TextEncoder().encode(req.text).slice(0, req.point)).length;
      // the view shows the cursor: focusing a long text scrolls it away
      // (to its end), so scroll back to the cursor, now and after layout
      text.focus({ preventScroll: true }); text.setSelectionRange(cursor, cursor);
      revealWritingCaret(); requestAnimationFrame(revealWritingCaret);
      // A y-or-n question in the line under the status line, as Emacs asks
      // in its minibuffer (no browser dialog)
      function askYesNo(question, yes) {
        if (searchBar) closeWritingSearch(true);
        var line = document.createElement("div"); line.className = "writing-search writing-question";
        var words = document.createElement("span"); words.className = "writing-search-label"; words.textContent = question;
        var block = document.createElement("span"); block.className = "writing-search-cursor"; block.setAttribute("aria-hidden", "true");
        line.setAttribute("role", "alert"); line.append(words, block); bar.after(line);
        function answer(e) {
          if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
          e.preventDefault(); e.stopImmediatePropagation();
          var k = e.key.toLowerCase();
          if (k === "y" || k === "n" || k === "escape" || (e.ctrlKey && k === "g")) {
            firstKeys = searchShortcut; line.remove(); text.focus();
            if (k === "y") yes();
          }
        }
        firstKeys = answer;
      }
      function finish(action, extra) {
        if (action === "quit!") action = "quit";
        else if (req.persistent && action === "quit" && (req.modified || text.value !== req.text)) {
          askYesNo("Modified buffer; quit without saving? (y or n) ", function () { finish("quit!"); });
          return;
        }
        var result = action === "cancel" ? null : JSON.stringify({ text: text.value,
          point: new TextEncoder().encode(text.value.slice(0, text.selectionStart)).length,
          save: action === "save", action: action, path: extra && extra.path, key: extra && extra.key,
          request: extra && extra.request });
        if (window.browseredFirstKeys === firstKeysOfThisView) window.browseredFirstKeys = null;
        document.removeEventListener("selectionchange",updateWritingCaret);window.removeEventListener("resize",updateWritingCaret);
        if(caretResize)caretResize.disconnect();if(caretFrame)cancelAnimationFrame(caretFrame);
        document.removeEventListener("selectionchange",updateStatus);if(statusFrame)cancelAnimationFrame(statusFrame);
        panel.remove(); document.body.classList.remove("document-active"); focusKeys(); resolve(result);
      }
      apply.addEventListener("click", function () { finish("apply"); });
      save.addEventListener("click", function () { finish("save"); });
      cancel.addEventListener("click", function () { finish("cancel"); });
      panel.addEventListener("paste", function (e) { e.stopPropagation(); });
      var searchBar = null, searchInput = null, searchDirection = 1, searchLabel = null, searchText = null;
      var prefixSelection = null;
      var searchOrigin = null, searchHit = null, searchQuery = "", searchReplace = false, searchComposition = null;
      function findWriting(repeat) {
        var query = searchInput.value;
        if (!query) { searchHit=null; searchStatus.textContent="";text.setSelectionRange(searchOrigin[0],searchOrigin[0]); return; }
        var from = repeat && searchHit ? (searchDirection>0 ? searchHit[1] : searchHit[0]-1) :
          (searchDirection>0 ? searchOrigin[0] : searchOrigin[1]-query.length);
        var found = searchDirection>0 ? text.value.indexOf(query,from) :
          (from<0 ? -1 : text.value.lastIndexOf(query,from));
        searchStatus.textContent = found<0 ? "Not found" : "";
        searchBar.classList.toggle("failing",found<0);
        if(found>=0) {
          searchHit=[found,found+query.length];text.setSelectionRange(found,found);
          revealWritingCaret();
        }
      }
      var searchStatus;
      function closeWritingSearch(cancelled) {
        if(!searchBar)return;
        if(cancelled) text.setSelectionRange(searchOrigin[0],searchOrigin[1],searchOrigin[2]);
        else if(searchHit) {var point=searchHit[0];text.setSelectionRange(point,point);}
        searchQuery=searchInput.value;searchBar.remove();searchBar=null;searchInput=null;searchLabel=null;searchText=null;text.focus();
        revealWritingCaret();
      }
      function searchShortcut(e) {
        if(!panel.contains(document.activeElement) || e.isComposing)return;
        var key=e.key.toLowerCase();
        // C-x and its second key are taken here, by the page's first key
        // listener.  Grammarly watches the keys before the page does, and
        // takes Ctrl-S in a text field for its snippets: so after C-x the
        // focus leaves the text (for the panel) until the second key.
        if(e.ctrlKey && !e.altKey && !e.metaKey && key==="x" && !panel.dataset.prefix && !searchBar){
          e.preventDefault();e.stopImmediatePropagation();panel.dataset.prefix="x";
          prefixSelection=[text.selectionStart,text.selectionEnd,text.selectionDirection];
          panel.tabIndex=-1;panel.focus({preventScroll:true});return;
        }
        if(panel.dataset.prefix==="x" && !["control","shift","alt","meta"].includes(key)){
          e.preventDefault();e.stopImmediatePropagation();delete panel.dataset.prefix;
          if(document.activeElement!==text){
            var top=text.scrollTop,left=text.scrollLeft;text.focus({preventScroll:true});
            if(prefixSelection)text.setSelectionRange(prefixSelection[0],prefixSelection[1],prefixSelection[2]);
            text.scrollTop=top;text.scrollLeft=left;
          }
          if(e.ctrlKey && key==="s")finish("save");
          else if(e.ctrlKey && key==="c")finish(req.persistent?"quit":"apply");
          // C-x C-f, C-x b: the editor's own commands (prompts on its
          // message line); prose comes back to this view
          else if(req.persistent && e.ctrlKey && key==="f")finish("key",{key:"C-x C-f"});
          else if(req.persistent && !e.ctrlKey && key==="b")finish("key",{key:"C-x b"});
          else if(key==="h"){text.focus();text.select();}
          return;
        }
        // M-s and M-r (Alt, or Esc then the key) search too: Grammarly
        // takes Ctrl-S in a text field before the page can see it
        var metaSearch=!e.ctrlKey && !e.metaKey && panel.dataset.prefix!=="x" &&
          ((e.altKey && (e.code==="KeyS" || e.code==="KeyR")) || (escapePrefix && (key==="s" || key==="r")));
        if(metaSearch){escapePrefix=false;key=(e.code==="KeyR" || key==="r")?"r":"s";}
        var searchKey=metaSearch || (e.ctrlKey && !e.altKey && !e.metaKey && (key==="s" || key==="r") && panel.dataset.prefix!=="x");
        if(searchKey) {
          // Capture before document-level snippet/save shortcuts. Browser
          // extension shortcuts registered outside the page remain external.
          e.preventDefault();e.stopImmediatePropagation();
          searchDirection=key==="s"?1:-1;
          if(searchLabel)searchLabel.textContent=searchDirection>0?"I-search: ":"I-search backward: ";
          if(!searchBar) {
            searchOrigin=[text.selectionStart,text.selectionEnd,text.selectionDirection];searchHit=searchQuery?[searchOrigin[0],searchOrigin[0]+searchQuery.length]:null;searchReplace=!!searchQuery;
            // the search line at the bottom, as Emacs's minibuffer: the query
            // with a blinking block cursor; the text keeps the focus
            searchBar=document.createElement("div");searchBar.className="writing-search";
            searchLabel=document.createElement("span");searchLabel.className="writing-search-label";
            searchText=document.createElement("span");searchText.className="writing-search-text";
            searchText.setAttribute("role","textbox");searchText.setAttribute("aria-readonly","true");searchText.setAttribute("aria-label","Search document");
            var block=document.createElement("span");block.className="writing-search-cursor";block.setAttribute("aria-hidden","true");
            searchInput={get value(){return searchText.textContent;},set value(v){searchText.textContent=v;}};
            searchInput.value=searchQuery;searchStatus=document.createElement("span");searchStatus.setAttribute("role","status");
            var close=document.createElement("button");close.textContent="Close search";close.onclick=function(){closeWritingSearch(false);};
            searchBar.append(searchLabel,searchText,block,searchStatus,close);bar.after(searchBar);
            searchBar.addEventListener("mousedown",function(event){if(event.target!==close){event.preventDefault();text.focus();}});
            searchLabel.textContent=searchDirection>0?"I-search: ":"I-search backward: ";
            text.focus();findWriting(!!searchQuery);
          } else {searchReplace=false;findWriting(true);}
        } else if(searchBar && key==="backspace" && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();e.stopImmediatePropagation();searchReplace=false;
          searchInput.value=Array.from(searchInput.value).slice(0,-1).join("");searchHit=null;findWriting(false);
        } else if(searchBar && (key==="enter" || key==="escape" || (e.ctrlKey && key==="g"))) {
          e.preventDefault();e.stopImmediatePropagation();closeWritingSearch(e.ctrlKey && key==="g");
        } else if(searchBar && !["Control","Alt","Shift","Meta"].includes(e.key) &&
                   (e.ctrlKey || e.metaKey || e.altKey || /^(Arrow|Home|End|Page|Delete|Tab)/.test(e.key))) {
          // A movement/editing command accepts the match, then runs normally.
          closeWritingSearch(false);
        }
      }
      function addSearchText(value) {
        if(searchReplace){searchInput.value="";searchReplace=false;}
        searchInput.value+=value;searchHit=null;findWriting(false);
      }
      text.addEventListener("beforeinput",function(e){
        if(searchBar && !searchComposition && e.inputType.startsWith("insert") && e.data!==null){
          e.preventDefault();addSearchText(e.data);
        }
      });
      text.addEventListener("paste",function(e){if(searchBar){e.preventDefault();e.stopImmediatePropagation();addSearchText(e.clipboardData.getData("text/plain"));}});
      text.addEventListener("compositionstart",function(){if(searchBar)searchComposition=text.value;});
      text.addEventListener("compositionend",function(e){if(searchBar && searchComposition!==null){text.value=searchComposition;searchComposition=null;addSearchText(e.data||"");}});
      // the page's first keydown listener (web/shell.html) calls firstKeys
      var firstKeys = searchShortcut;
      function firstKeysOfThisView(e) { if (panel.isConnected) firstKeys(e); }
      window.browseredFirstKeys = firstKeysOfThisView;
      // Keep this a real textarea so Grammarly and native editing/undo work.
      var mark = null, killText = "", lastKill = false, escapePrefix = false;
      function head() { return text.selectionDirection === "backward" ? text.selectionStart : text.selectionEnd; }
      function move(to, extend) {
        to = Math.max(0, Math.min(text.value.length, to));
        var anchor = mark;
        if (anchor === null && extend)
          anchor = text.selectionDirection === "backward" ? text.selectionEnd : text.selectionStart;
        if (anchor === null) text.setSelectionRange(to, to);
        else text.setSelectionRange(Math.min(anchor, to), Math.max(anchor, to), to < anchor ? "backward" : "forward");
        lastKill = false;revealWritingCaret();
      }
      function previous(pos) { return pos > 1 && /[\uDC00-\uDFFF]/.test(text.value[pos-1]) ? pos-2 : Math.max(0,pos-1); }
      function next(pos) { return pos < text.value.length && text.value.codePointAt(pos) > 65535 ? pos+2 : Math.min(text.value.length,pos+1); }
      function pagePosition(pos,direction){
        var lines=text.value.split("\n"),prefix=text.value.slice(0,pos).split("\n"),row=prefix.length-1,column=prefix[prefix.length-1].length;
        var style=getComputedStyle(text),count=Math.max(1,Math.floor((text.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))/parseFloat(style.lineHeight))-2);
        var target=Math.max(0,Math.min(lines.length-1,row+direction*count)),offset=0;
        for(var i=0;i<target;i++)offset+=lines[i].length+1;
        return offset+Math.min(column,lines[target].length);
      }
      function word(pos, direction) {
        var v=text.value, isWord=c=>/[\p{L}\p{N}_]/u.test(c || "");
        if (direction > 0) {
          while(pos<v.length && !isWord(String.fromCodePoint(v.codePointAt(pos)))) pos=next(pos);
          while(pos<v.length && isWord(String.fromCodePoint(v.codePointAt(pos)))) pos=next(pos);
        } else {
          while(pos>0 && !isWord(v.slice(previous(pos),pos))) pos=previous(pos);
          while(pos>0 && isWord(v.slice(previous(pos),pos))) pos=previous(pos);
        }
        return pos;
      }
      function edit(start,end,replacement) {
        text.setSelectionRange(start,end); mark=null;
        // insertText participates in the browser undo history and emits input.
        if (!document.execCommand("insertText",false,replacement)) {
          text.setRangeText(replacement,start,end,"end");
          text.dispatchEvent(new Event("input",{bubbles:true}));
        }
      }
      text.addEventListener("input",function(){mark=null;lastKill=false;});
      text.addEventListener("mousedown",function(){mark=null;escapePrefix=false;});
      text.addEventListener("keydown",function(e){
        if(["Control","Shift","Alt","Meta"].includes(e.key)) return;
        if(e.isComposing || e.key === "Dead" || e.key === "Process") return;
        if(e.key === "Escape") {e.preventDefault();escapePrefix=true;return;}
        var meta=(e.altKey && !(e.getModifierState && e.getModifierState("AltGraph"))) || escapePrefix;
        escapePrefix=false;
        var key=baseKey(e),pos=head(),v=text.value;
        var start=pos===0?0:v.lastIndexOf("\n",pos-1)+1,end=v.indexOf("\n",pos);if(end<0)end=v.length;
        var to=null,range=null;
        if(e.ctrlKey && !e.altKey && !e.metaKey && (e.key==="Home" || e.key==="End")){
          e.preventDefault();move(e.key==="Home"?0:v.length,e.shiftKey);return;
        }
        if(e.ctrlKey && !e.altKey && !e.metaKey) {
          switch(key){
          case "v": to=pagePosition(pos,1);break;
          case "a": to=start;break;
          case "e": to=end;break;
          case "b": to=previous(pos);break;
          case "f": to=next(pos);break;
          case "p": {var up=Math.max(0,start-1),upStart=v.lastIndexOf("\n",up-1)+1;to=start===0?0:Math.min(upStart+pos-start,up);break;}
          case "n": {var down=Math.min(v.length,end+1),downEnd=v.indexOf("\n",down);to=Math.min(down+pos-start,downEnd<0?v.length:downEnd);break;}
          case " ": case "2": e.preventDefault();mark=pos;lastKill=false;return;
          case "g": e.preventDefault();mark=null;text.setSelectionRange(pos,pos);lastKill=false;delete panel.dataset.prefix;return;
          case "k": range=[pos,end===pos?Math.min(v.length,pos+1):end];break;
          case "w": range=[text.selectionStart,text.selectionEnd];break;
          case "y": e.preventDefault();edit(text.selectionStart,text.selectionEnd,killText);return;
          case "d": e.preventDefault();edit(text.selectionStart,text.selectionEnd===text.selectionStart?next(pos):text.selectionEnd,"");return;
          case "h": e.preventDefault();edit(text.selectionStart===text.selectionEnd?previous(pos):text.selectionStart,text.selectionEnd,"");return;
          case "-": if (!e.shiftKey) break; // C-_ on the physical minus key
          case "/": case "_": e.preventDefault();mark=null;document.execCommand("undo");return;
          }
        } else if(meta && !e.ctrlKey && !e.metaKey) {
          if(key==="v")to=pagePosition(pos,-1);
          else if(key==="b")to=word(pos,-1);
          else if(key==="f")to=word(pos,1);
          else if(key==="d")range=[pos,word(pos,1)];
          else if(e.key==="Backspace")range=[word(pos,-1),pos];
          else if(key==="w"){e.preventDefault();if(text.selectionStart!==text.selectionEnd)killText=v.slice(text.selectionStart,text.selectionEnd);mark=null;text.setSelectionRange(pos,pos);lastKill=false;return;}
          else if(e.key==="<" || (e.shiftKey && key===","))to=0;
          else if(e.key===">" || (e.shiftKey && key==="."))to=v.length;
        } else if(e.key==="Tab" && !e.ctrlKey && !e.metaKey){e.preventDefault();edit(text.selectionStart,text.selectionEnd,"\t");return;}
        if(to!==null){e.preventDefault();var selecting=e.shiftKey && !(meta && (key==="," || key==="." || e.key==="<" || e.key===">"));move(to,selecting);return;}
        if(range){e.preventDefault();if(range[0]===range[1])return;var killed=v.slice(range[0],range[1]),join=lastKill,backwards=range[0]<pos;edit(range[0],range[1],"");killText=join?(backwards?killed+killText:killText+killed):killed;lastKill=true;return;}
        if(!e.ctrlKey && !e.metaKey && !meta)lastKill=false;
      });
      panel.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        var key = e.key.toLowerCase();
        if ((isMac ? e.metaKey : e.ctrlKey) && key === "s") {
          e.preventDefault(); finish("save"); return;
        }
        if (e.ctrlKey && !e.altKey && !e.metaKey && key === "c" && !panel.dataset.prefix) {
          panel.dataset.prefix = "c";   // not prevented: Ctrl-C still copies on Windows and Linux
        } else if (panel.dataset.prefix === "c") {
          delete panel.dataset.prefix;
          // C-c d: the same buffer in the advanced (canvas) editor
          if (key === "d" && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); finish(req.persistent ? "advanced" : "apply"); }
        } else if (e.ctrlKey && key === "x") {
          e.preventDefault(); panel.dataset.prefix = "x";
        } else if (panel.dataset.prefix === "x") {
          delete panel.dataset.prefix;
          if (e.ctrlKey && key === "c") { e.preventDefault(); finish(req.persistent ? "quit" : "apply"); }
          else if (e.ctrlKey && key === "s") { e.preventDefault(); finish("save"); }
          else if (key === "h") { e.preventDefault(); text.focus(); text.select(); }
        }
      });
    });
  }

  // Hosted pages can navigate their browser filesystem without executing
  // system programs. The loopback launcher continues to use /bin/sh.
  var browserShellDirectory = null, browserShellBase = null, browserShellPrevious = null;
  function shellWords(source) {
    var commands = [], words = [], word = "", started = false, quote = null;
    function finishWord() { if (started) { words.push(word); word = ""; started = false; } }
    function finishCommand(next) {
      finishWord();
      if (!words.length) throw new Error("Expected a command.");
      commands.push({words:words,next:next}); words = [];
    }
    source = source.replace(/^exec 2>&1\r?\n/, "").replace(/\\\r?\n/g, "");
    for (var i = 0; i < source.length; i++) {
      var ch = source[i];
      if (ch === "\\" && quote !== "'") {
        if (++i >= source.length) throw new Error("Incomplete escape.");
        word += source[i]; started = true;
      } else if (quote) {
        if (ch === quote) quote = null; else word += ch;
      } else if (ch === "'" || ch === '"') { quote = ch; started = true; }
      else if (/\s/.test(ch) && ch !== "\n") finishWord();
      else if (ch === ";" || ch === "\n") {
        finishWord(); if (words.length) finishCommand(";");
      } else if (ch === "&" && source[i + 1] === "&") { finishCommand("&&"); i++; }
      else if ("|&<>$`".indexOf(ch) >= 0) throw new Error("Pipes, redirection and expansion require the local shell.");
      else { word += ch; started = true; }
    }
    if (quote) throw new Error("Unclosed quote.");
    finishWord();
    if (words.length) finishCommand(null);
    else if (commands.length && commands[commands.length - 1].next === "&&") throw new Error("Expected a command after &&.");
    return commands;
  }
  function browserShellPath(name, base) {
    if (name === "~") name = HOME;
    else if (name.indexOf("~/") === 0) name = HOME + name.slice(1);
    if (name.charAt(0) !== "/") name = base + "/" + name;
    var parts = [];
    name.split("/").forEach(function (part) {
      if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
    });
    return "/" + parts.join("/");
  }
  function shellDisplayPath(path) {
    return path === HOME ? "~" : path.indexOf(HOME + "/") === 0 ? "~" + path.slice(HOME.length) : path;
  }
  async function shellReadDirectory(path) {
    if (path.indexOf(HOME + "/") === 0) await ensure(path + "/", false);
    if (unlisted[path]) await listDirectory(unlisted[path], path, []);
    var stat = FS.stat(path);
    if (!FS.isDir(stat.mode)) throw new Error(shellDisplayPath(path) + ": not a directory");
    return FS.readdir(path);
  }
  async function browserShell(req) {
    var base = browserShellPath(req.directory || "/", HOME);
    if (browserShellDirectory === null || (!commandDirectoryExplicit && browserShellBase !== base)) {
      browserShellBase = base;
      browserShellDirectory = browserShellPath(base === "/" ? (FS.cwd() === "/" ? HOME : FS.cwd()) : base, HOME);
      browserShellPrevious = null;
    }
    var commands;
    try { commands = shellWords(req.command); }
    catch (e) { return ["Browser shell: " + e.message + "\n", "", 2]; }
    var output = "", status = 0, run = true;
    for (var command of commands) {
      if (run) {
        var args = command.words.slice(), name = args.shift();
        try {
          status = 0;
          if (name === "help") {
            output += "Browser commands: ls [-ald] [path ...], cd [path|-], pwd, help.\nQuotes, ; and && are supported. Use Browsered.command for the full system shell.\n";
          } else if (name === "pwd") {
            if (args.length) throw new Error("pwd takes no arguments");
            output += shellDisplayPath(browserShellDirectory) + "\n";
          } else if (name === "cd") {
            if (args.length > 1) throw new Error("cd takes one folder");
            var target = !args.length ? HOME : args[0] === "-" ? browserShellPrevious : browserShellPath(args[0], browserShellDirectory);
            if (!target) throw new Error("no previous folder");
            await shellReadDirectory(target);
            FS.chdir(target);
            browserShellPrevious = browserShellDirectory; browserShellDirectory = FS.cwd();
            commandDirectoryExplicit = true;
            rememberCommandDirectory(shellDisplayPath(browserShellDirectory));
            output += shellDisplayPath(browserShellDirectory) + "\n";
          } else if (name === "ls") {
            var all = false, long = false, directoryOnly = false, paths = [], options = true;
            for (var arg of args) {
              if (options && arg === "--") options = false;
              else if (options && /^-./.test(arg)) {
                for (var flag of arg.slice(1)) {
                  if (flag === "a") all = true;
                  else if (flag === "l") long = true;
                  else if (flag === "d") directoryOnly = true;
                  else throw new Error("unsupported ls option: -" + flag);
                }
              } else paths.push(arg);
            }
            if (!paths.length) paths.push(".");
            for (var part of paths) {
              var path = browserShellPath(part, browserShellDirectory);
              // List the parent first so granted but lazy files are available.
              await shellReadDirectory(path.slice(0, path.lastIndexOf("/")) || "/");
              if (path.indexOf(HOME + "/") === 0) await ensure(path + "/", false);
              var info = FS.stat(path), entries;
              if (FS.isDir(info.mode) && !directoryOnly) {
                entries = (await shellReadDirectory(path)).filter(function (entry) { return all || entry.charAt(0) !== "."; }).sort();
                if (paths.length > 1) output += shellDisplayPath(path) + ":\n";
              } else entries = [null];
              for (var entry of entries) {
                var file = entry === null ? path : path + "/" + entry;
                var stat = FS.stat(file), dir = FS.isDir(stat.mode), label = entry === null ? part : entry;
                output += (long ? (dir ? "d " : "- ") + String(stat.size).padStart(10) + " " : "") + label + (dir ? "/" : "") + "\n";
              }
            }
          } else {
            status = 127;
            output += name + ": not a browser command. Type help, or launch Browsered.command for the full system shell.\n";
          }
        } catch (e) { status = 1; output += name + ": " + (e.message || String(e)) + "\n"; }
      }
      run = command.next !== "&&" || (run && status === 0);
    }
    return [output, "", status];
  }

  var commandDirectoryExplicit = false, localShellDirectory = null, localShellBase = null;
  function rememberCommandDirectory(path) {
    try { localStorage.setItem("browsered-last-folder", path.replace(/\/$/, "") + "/"); } catch (_) {}
  }
  function currentCommandDirectory() {
    return localShellDirectory || browserShellDirectory || (FS.cwd() === "/" ? HOME : FS.cwd());
  }
  async function acceptLocalDirectory(path, previous) {
    var normalized = browserShellPath(path, HOME);
    if (normalized !== browserShellPath(previous === "/" ? HOME : previous, HOME)) commandDirectoryExplicit = true;
    localShellDirectory = path === "~" ? "~/" : path;
    rememberCommandDirectory(path);
    // Keep native paths usable by file prompts, including paths outside HOME.
    // Register lazily: cd must not recursively read or import a user's folder.
    if (normalized !== "/" && normalized !== HOME && !folderOf(normalized + "/")) {
      var meta = await (await localFileRequest("stat",path)).json();
      var handle = localHandle(path,meta);
      mkdirs(normalized); folders.push({path:normalized,handle:handle});
      unlisted[normalized] = handle; rememberFolder(normalized,handle);
    }
    try { FS.chdir(normalized); } catch (_) {}
  }
  async function commandCompletions(line) {
    // Find the current word without splitting quoted or escaped spaces.
    var start = 0, segment = 0, quote = null, escape = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && quote !== "'") { escape = true; continue; }
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (/\s/.test(ch)) start = i + 1;
      else if (ch === ";" || ch === "&") { start = i + 1; segment = start; }
    }
    var prefix = line.slice(0,start), raw = line.slice(start), token = "", words;
    try {
      words = shellWords(line.slice(segment,start));
      var parsed = raw ? shellWords(raw + (quote || "")) : [];
      token = parsed.length ? parsed[0].words[0] : "";
    } catch (_) { return ""; }
    if (!words.length) {
      return ["cd","ls","pwd","help"].filter(function (s) {return s.indexOf(token)===0;})
        .map(function(s) {return prefix+s;}).join("\n");
    }
    var command = words[words.length-1].words[0], directoriesOnly = command === "cd";
    var slash = token.lastIndexOf("/"), folder = slash < 0 ? "" : token.slice(0,slash+1), stem = token.slice(slash+1);
    var cwd = currentCommandDirectory(), entries;
    try {
      if (location.protocol === "http:" && location.hostname === "127.0.0.1") {
        if (cwd === HOME) cwd = "~/";
        else if (cwd.indexOf(HOME + "/") === 0) cwd = "~" + cwd.slice(HOME.length);
        var path = folder.charAt(0)==="/" || folder.indexOf("~/")===0 ? folder : cwd.replace(/\/$/,"") + "/" + folder;
        entries = await (await localFileRequest("list",path || "~/")).json();
      } else {
        var at = browserShellPath(folder || ".",cwd);
        entries = (await shellReadDirectory(at)).map(function(name) { return {name:name,kind:FS.isDir(FS.stat(at+"/"+name).mode)?"directory":"file"}; });
      }
    } catch (_) { return ""; }
    return entries.filter(function(entry) {
      return !/[\r\n]/.test(entry.name) && entry.name!=="." && entry.name!==".." && entry.name.indexOf(stem)===0 &&
        (stem.charAt(0)==="." || entry.name.charAt(0)!==".") && (!directoriesOnly || entry.kind==="directory");
    }).sort(function(a,b) {return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;}).map(function(entry) {
      var value = folder + entry.name + (entry.kind==="directory" ? "/" : "");
      if (value.indexOf("~/")===0 && (raw.charAt(0)==='"' || raw.charAt(0)==="'" || /[\s'"\\;$&|<>`]/.test(value)))
        value='~/"'+value.slice(2).replace(/[\\"$`]/g,"\\$&")+'"';
      else if (raw.charAt(0)==="'" && value.indexOf("'")<0) value="'"+value+"'";
      else if (raw.charAt(0)==='"' || /[\s'"\\;$&|<>`]/.test(value)) value='"'+value.replace(/[\\"$`]/g,"\\$&")+'"';
      return prefix+value;
    }).join("\n");
  }

  var calls = {
    "writing-mode": writingMode,
    "schemer-prepare-file": async function(path){
      if(path.indexOf("~/")===0)path=HOME+path.slice(1);
      if(path.charAt(0)!=="/")path=PATH.join2(FS.cwd(),path);
      var parent=path.slice(0,path.lastIndexOf("/"))||"/";
      await ensure(parent+"/",false);return path;
    },
    "schemer-supported": function(){return typeof WebAssembly.Suspending==="function"&&typeof WebAssembly.promising==="function"?"jspi":"compatibility";},
    "schemer-status": function(){return window.BrowseredSchemer?BrowseredSchemer.status():"{}";},
    "command-complete": commandCompletions,
    "command-context": function (directory) {
      if (!commandDirectoryExplicit) {
        var base = browserShellPath(directory || "/",HOME);
        if (base==="/") base=HOME;
        browserShellDirectory=base;browserShellBase=base;
        localShellDirectory=base;localShellBase=base;
      }
      return "ok";
    },
    "shell-run": async function (json) {
      var req = JSON.parse(json);
      if (location.protocol !== "http:" || location.hostname !== "127.0.0.1")
        return JSON.stringify(await browserShell(req));
      var base = browserShellPath(req.directory || "~/",HOME);
      if (!localShellDirectory || (!commandDirectoryExplicit && localShellBase !== base)) {
        localShellDirectory = req.directory || "~/"; localShellBase = base;
      }
      var folder = localShellDirectory;
      if (folder === HOME) folder = "~/";
      else if (folder.indexOf(HOME + "/") === 0) folder = "~/" + folder.slice(HOME.length + 1);
      try {
        var response = await fetch("/shell", {method:"POST", headers:{"Content-Type":"application/x-browsered-shell"},
          body: String(Math.min(600, Math.max(1, req.timeout || 60))) + "\n" + folder + "\n" + req.command});
        var text = await response.text();
        if (!response.ok) return JSON.stringify([text, "", 127]);
        var directory = response.headers.get("X-Browsered-Directory");
        if (directory) {
          try { await acceptLocalDirectory(decodeURIComponent(directory),folder); }
          catch (e) { notice("Command finished, but its folder could not be opened: " + e.message); }
        }
        var cut = text.indexOf("\n");
        return JSON.stringify([text.slice(cut + 1), "", Number(text.slice(0, cut))]);
      } catch (e) { return JSON.stringify(["", "Local shell unavailable: " + e.message, 127]); }
    },
    "codex-ask": function (json) { return codexAsk(JSON.parse(json), []); },
    "claude-ask": function (json) { return claudeAsk(JSON.parse(json)); },
    "claude-bridge": function () { return claudeBridge(); },
    "api-key": apiKeyPrompt,
    "irene-dixe": function (json) { return ireneDixe(json); },
    "pdf-render": function (json) {
      return renderPdf(json).catch(function (e) { return JSON.stringify({ error: e.message || String(e) }); });
    },
    "ttfy-ask": function (json) {
      return ttfyAsk(json).catch(function (e) { return "TTFY failed: " + (e.message || e); });
    },
    "pick-folder": function () { return pickFolder(); },
    // M-x allow-saving / forbid-saving: PATH is a file of the computer
    "saving-target": function (path) {
      var key = computerTarget(path);
      return key ? key.replace(HOME, "~") : null;
    },
    "allow-saving": function (path) {
      var key = computerTarget(path);
      if (!key) return null;
      allowed[key] = true;
      return key.replace(HOME, "~");
    },
    "forbid-saving": function (path) {
      var key = computerTarget(path);
      if (!key) return null;
      allowed[key] = false;
      return key.replace(HOME, "~");
    },
    "saving-allowed": function (path) { return computerTarget(path) && mayWrite(path) ? "yes" : null; },
    "ask-folder": function (typed) { return askFolder(typed); },
    "mount-folder": function (where) { return mountPicked(where); },
    "open-file": function () { return openFile(); },
    "download": function (path) { download(path); return "ok"; },
    "computer-path": function (path) {
      var f = folderOf(path);
      return f ? f.folder.handle.name + "/" + f.rest : (files[path] ? files[path].name : null);
    },
    "folder-access": function () { return window.showDirectoryPicker || localFilesAvailable() ? "yes" : null; },
    "user-agent": function () { return navigator.userAgent; },
    // ?advanced in the address: prose files too stay in the advanced editor
    "auto-document": function () { return new URLSearchParams(location.search).has("advanced") ? null : "yes"; },
    // M-x grammarly-status: what Grammarly did with the page and the field
    "grammarly-status": function () {
      function marks(el) {
        if (!el) return "";
        return Array.prototype.filter.call(el.attributes, function (a) { return /gr|gramm/i.test(a.name); })
          .map(function (a) { return a.name; }).join(" ");
      }
      var page = marks(document.body) + " " + marks(document.documentElement);
      var shadow = document.querySelectorAll("grammarly-extension, grammarly-desktop-integration, grammarly-popups").length;
      return "Grammarly in the page: " + (page.trim() || shadow ? "yes (" + (page.trim() || shadow + " elements") + ")" : "no") +
        ";  field: " + (layer ? (marks(layer) || "not taken by Grammarly") : "none ([GRAMMAR] first)");
    },
    "grammarly-show-field": function () {
      if (!layer) return null;
      layer.classList.toggle("shown");
      return layer.classList.contains("shown") ? "shown" : "hidden";
    },
    "schemer-hot-status": function () { return BrowseredSchemer.hotStatus(); },
    "test-result": function (text) { Module.browsered._test = text; return "ok"; },
    "mkdirs": function (path) { mkdirs(path); return "ok"; },
    // the assistants' APIs: {url, headers, body} -> {status, text}
    "post": async function (json) {
      var req = JSON.parse(json), answer;
      try {
        answer = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
      } catch (e) {
        return JSON.stringify({ status: 0, text: JSON.stringify({ type: "error",
          error: { message: "the request did not reach " + req.url + " (" + e.message + ")" } }) });
      }
      return JSON.stringify({ status: answer.status, text: await answer.text() });
    }
  };

  async function call(name, arg) {
    var f = calls[name];
    if (!f) return null;
    try { return await f(arg); }
    catch (e) {
      if (e && e.name === "AbortError") return null;     // the picker was closed
      console.warn(name, e);
      return null;
    }
  }

  function dropped(e) {
    e.preventDefault();
    var items = e.dataTransfer.files;
    if (!items || !items.length) return;
    takeFiles(items).then(function (path) {
      if (path) runScheme("(find-file " + schemeString(path) + ")");
    });
  }

  // a failure is shown on the page, not left as a blank window
  function showFailure(text) {
    var n = document.getElementById("notice");
    n.textContent = "Browsered failed: " + text;
    n.className = "failure";
    n.hidden = false;
  }

  // Injected extensions can throw on this window even while editing works.
  // Attribute by source, never by message: the same error in our own code
  // must remain visible. Leave extension diagnostics in the browser console.
  function extensionFailure(filename, error) {
    var extensionURL = /\b(?:chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension):\/\//i;
    if (filename) return extensionURL.test(filename);
    var stack = error && error.stack;
    if (typeof stack !== "string") return false;
    var frame = stack.split("\n").find(function (line) {
      return /^\s*at\s/.test(line) || /@[a-z][a-z0-9+.-]*:\/\//i.test(line);
    });
    return !!frame && extensionURL.test(frame);
  }

  function start() {
    window.addEventListener("error", function (e) {
      if (!extensionFailure(e.filename, e.error)) showFailure(e.message);
    });
    window.addEventListener("unhandledrejection", function (e) {
      if (!extensionFailure(null, e.reason))
        showFailure(String(e.reason && e.reason.message || e.reason));
    });
    canvas = document.getElementById("screen");
    ctx = canvas.getContext("2d", { alpha: false });
    ctx.textBaseline = "alphabetic";
    layout();
    watchFiles();
    keysField = document.getElementById("keys");
    keysField.addEventListener("input", function (e) { if (!e.isComposing) takeTyped(); });
    keysField.addEventListener("compositionend", takeTyped);
    keysField.focus();
    // no button for the writing view: C-c d, or C-x C-f of a prose file (web.scm)
    document.addEventListener("keydown", keydown);
    document.addEventListener("paste", function (e) {
      e.preventDefault();
      pasteText(e.clipboardData.getData("text/plain"));
    });
    window.addEventListener("resize", resized);
    window.addEventListener("focus", function () {
      if (finished || document.querySelector(".api-key-dialog, #writing-mode")) return;
      focused = true; focusKeys(); push(0x0C);
      refreshFiles();
    });
    window.addEventListener("blur", function () { focused = false; last = null; push(0x0C); });
    canvas.addEventListener("mousedown", function (e) {
      e.preventDefault();
      focusKeys();
      if (e.button === 0) { buttonDown = true; mouse(0, e, false); e.preventDefault(); }
    });
    window.addEventListener("mousemove", function (e) { if (buttonDown) mouse(32, e, false); });
    window.addEventListener("mouseup", function (e) {
      if (e.button === 0 && buttonDown) { buttonDown = false; mouse(0, e, true); }
    });
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", dropped);
    window.addEventListener("beforeunload", function (e) {
      if (finished) return;             // C-x C-c asked about unsaved files already
      e.preventDefault(); e.returnValue = "";
    });
  }

  return {
    start: start,
    // C-x C-c exits the editor. Closing a user-opened tab may be denied;
    // in that case leave a closed screen, never restart on an arbitrary key.
    ended: function () {
      finished = true;
      queue = []; evals = [];
      canvas.hidden = true; canvas.style.display = "none";
      keysField.blur(); keysField.disabled = true;
      removeLayer();
      document.getElementById("notice").hidden = true;
      var closed = document.createElement("section");
      closed.id = "editor-closed";
      var title = document.createElement("h1"); title.textContent = "Browsered is closed";
      var text = document.createElement("p");
      text.textContent = "You can close this tab with Cmd-W (Mac) or Ctrl-W (Windows/Linux).";
      var restart = document.createElement("button"); restart.textContent = "Restart Browsered";
      restart.addEventListener("click", function () { location.reload(); });
      closed.append(title, text, restart); document.body.append(closed);
      restart.focus();
      // Started by Browsered.command: its launcher stops too (and closes
      // its Terminal window); the next start is Browsered.command again.
      // A beacon goes even if the tab closes at once; the fetch, if the tab
      // stays, gives the answer to show.
      if (localBridge()) {
        try { navigator.sendBeacon("/quit", "quit"); } catch (e) { /* the fetch below */ }
        fetch("/quit", { method: "POST", keepalive: true, body: "quit" })
          .then(function (r) { return r.text(); })
          .then(function (t) {
            if (t.indexOf("Browsered launcher stopped") !== 0) return;   // not the launcher
            text.textContent = "Browsered.command has stopped too. Double-click it to start Browsered again; " +
                               "you can close this tab with Cmd-W (Mac) or Ctrl-W.";
            restart.hidden = true;
          }).catch(function () {   // the beacon stopped it first
            text.textContent = "Browsered.command has stopped too. Double-click it to start Browsered again.";
            restart.hidden = true;
          });
      }
      try { window.close(); } catch (e) { /* not allowed */ }
    },
    call: call,
    restoreFolders: restoreFolders,
    takeEval: function () {
      var e = evals.length ? evals.shift() : null;
      if (e && e.indexOf("(web-layer-edit ") === 0) layerTaken++;
      return e;
    },
    textLayer: textLayer,
    // the editor's memory, for compiled hot paths (web/schemer.js)
    memory: function () { return wasmMemory; },
    home: function () { return HOME; },
    rows: function () { return nRows; },
    cols: function () { return nCols; },
    paint: paint,
    painted: function () { return last !== null || lastCursor !== -1; },
    nextByte: function () {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise(function (resolve) { waiting = resolve; });
    },
    flushInput: function () { queue.length = 0; },
    copy: function (text) {
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
    },
    paste: function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) return Promise.resolve(null);
      return navigator.clipboard.readText().catch(function () { return null; });
    },
    font: function (name, size) {
      if (name) family = "'" + name.replace(/\.(ttf|otf|ttc)$/i, "") + "', " + family;
      if (size > 0) points = size;
      layout();
    },
    setOption: function (name, value) { if (name === "option-is-meta") optionIsMeta = !!value; }
  };
})();

Module.preRun = Module.preRun || [];
// Browsered.html?reset starts without what the browser kept (HOME and
// the folders given): for a page that does not start.
function browseredForget(done) {
  var names = ["/home/web_user", "browsered-folders"], left = names.length;
  names.forEach(function (n) {
    var r = indexedDB.deleteDatabase(n);
    r.onsuccess = r.onerror = r.onblocked = function () { if (--left === 0) done(); };
  });
}

// Before HOME is read back: delete from the browser's storage what earlier
// Browsereds kept of the computer's folders (anything inside a folder
// directly in HOME, except ~/.browsered and the like).  Only the names
// are read, never the contents, so even a large old copy goes quickly.
function browseredPrune(done) {
  var home = "/home/web_user", req;
  var finish = function () { try { if (req && req.result) req.result.close(); } catch (e) {} done(); };
  try { req = indexedDB.open(home); } catch (e) { done(); return; }
  req.onerror = function () { done(); };
  req.onupgradeneeded = function () { /* no storage yet */ };
  req.onsuccess = function () {
    var db = req.result;
    if (!db.objectStoreNames.contains("FILE_DATA")) { finish(); return; }
    var tx = db.transaction("FILE_DATA", "readwrite"), store = tx.objectStore("FILE_DATA");
    var doomed = [], folders = {};
    var cursor = store.openKeyCursor();
    cursor.onsuccess = function () {
      var c = cursor.result;
      if (c) {
        var key = String(c.key);
        if (key.indexOf(home + "/") === 0) {
          var rest = key.slice(home.length + 1), first = rest.split("/")[0];
          if (rest.indexOf("/") > 0 && first.charAt(0) !== ".") {
            doomed.push(key);
            folders[home + "/" + first] = true;
          }
        }
        c.continue();
      } else {
        Object.keys(folders).forEach(function (k) { doomed.push(k); });
        doomed.forEach(function (k) { store.delete(k); });
      }
    };
    tx.oncomplete = finish;
    tx.onerror = tx.onabort = finish;
  };
}

Module.preRun.push(function () {
  Module.browsered.start();
  // irene-dixe, at the place where Schememax keeps it, for sketch.scm to
  // find (its code is the module in Browsered.html); a "display" for it
  try {
    FS.writeFile("/irene-dixe", "browser\n");
    FS.chmod("/irene-dixe", 493);   // 0755
  } catch (e) { /* none */ }
  if (typeof ENV !== "undefined") ENV.DISPLAY = "browser";
  // HOME comes back from IndexedDB before the editor starts
  try { FS.mkdir("/home/web_user"); } catch (e) { /* exists */ }
  FS.mount(IDBFS, {}, "/home/web_user");
  Module.addRunDependency("home");
  var load = function () {
    FS.syncfs(true, function (err) {
      if (err) console.warn("Browsered: the browser's storage is unavailable", err);
      // the user's folder was ~/.schememax before it was ~/.browsered (web.scm)
      try { FS.stat("/home/web_user/.browsered"); }
      catch (e) { try { FS.rename("/home/web_user/.schememax", "/home/web_user/.browsered"); } catch (e2) { /* none */ } }
      Module.removeRunDependency("home");
      Module.browsered.restoreFolders();
    });
  };
  if (/[?&]reset\b/.test(location.search)) browseredForget(load); else browseredPrune(load);
  // still nothing on the screen after 15 s: say so, and how to start afresh
  setTimeout(function () {
    if (Module.browsered.painted()) return;
    var n = document.getElementById("notice");
    n.textContent = "Browsered has not started after 15 s. Open Browsered.html?reset to start " +
                    "without the files and folders the browser kept.";
    n.className = "failure";
    n.hidden = false;
  }, 15000);
});
Module.print = Module.print || function (t) { console.log(t); };
Module.printErr = Module.printErr || function (t) { console.warn(t); };
Module.onAbort = function (what) {
  var n = document.getElementById("notice");
  if (n) { n.textContent = "Browsered stopped: " + what; n.className = "failure"; n.hidden = false; }
};
Module.onExit = function (code) { console.warn("Browsered exited with status " + code); };
