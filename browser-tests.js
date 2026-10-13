// Run against a disposable field, never the user's saved document.
const field = document.getElementById("test-field");
const results = [];
let inputEvents = 0;
field.addEventListener("input", () => { inputEvents += 1; });

function expect(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  results.push(`PASS ${description}`);
}

function reset(text, position = 0) {
  field.value = text;
  field.focus();
  field.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
  field.setSelectionRange(position, position);
}

function press(key, code, modifiers = {}) {
  field.dispatchEvent(new KeyboardEvent("keydown", {
    key, code, bubbles: true, cancelable: true, ctrlKey: true, ...modifiers
  }));
}

try {
  // Keep tests independent of the system clipboard and its permission prompt.
  globalThis.__browseredEmacsKeys.systemClipboard = false;
  const movement = globalThis.__browseredEmacsKeys.movement;
  const sample = "First line\nHi\nAnother line";
  expect(movement.lineStart(sample, 0), 0, "Beginning of first line");
  expect(movement.lineStart("\nabc", 0), 0, "Empty first line");
  expect(movement.lineStart(sample, 11), 11, "Beginning of second line");
  expect(movement.lineEnd(sample, 11), 13, "End of second line");
  expect(movement.vertical(sample, 8, 1, 8), 13, "Downward movement clamps to short line");
  expect(movement.vertical(sample, 13, 1, 8), 22, "Downward movement restores goal column");
  expect(movement.vertical(sample, 22, -1, 8), 13, "Upward movement clamps to short line");
  expect(movement.vertical(sample, 13, -1, 8), 8, "Upward movement restores goal column");
  expect(movement.word("héllo, world", 0, 1), 5, "Forward word with accent");
  expect(movement.word("héllo, world", 5, 1), 12, "Forward word skips punctuation");
  expect(movement.word("héllo, world", 12, -1), 7, "Backward word movement");
  expect(movement.word("héllo, world", 7, -1), 0, "Backward word skips punctuation");
  expect(movement.nextChar("a😀b", 1), 3, "Forward movement crosses complete emoji");
  expect(movement.prevChar("a😀b", 3), 1, "Backward movement crosses complete emoji");

  reset("first\nsecond", 9);
  press("a", "KeyA");
  expect(field.selectionStart, 6, "Ctrl+A moves to line start");
  press("e", "KeyE");
  expect(field.selectionStart, 12, "Ctrl+E moves to line end");

  reset("hello world");
  press("k", "KeyK");
  expect(field.value, "", "Ctrl+K kills a line");
  press("y", "KeyY");
  expect(field.value, "hello world", "Ctrl+Y restores killed text");
  expect(inputEvents >= 2, true, "Kills and yanks emit input events");

  reset("first\nsecond");
  press("k", "KeyK");
  press("k", "KeyK");
  press("k", "KeyK");
  expect(field.value, "", "Repeated kills remove text and newline");
  press("y", "KeyY");
  expect(field.value, "first\nsecond", "Consecutive kills concatenate");

  reset("abc def");
  press(" ", "Space");
  press("f", "KeyF");
  press("f", "KeyF");
  expect(field.selectionEnd, 2, "Mark extends region");
  press("w", "KeyW");
  expect(field.value, "c def", "Ctrl+W kills region");
  press("y", "KeyY");
  expect(field.value, "abc def", "Region yank restores text");

  reset("abc def");
  press(" ", "Space");
  press("e", "KeyE");
  press("∑", "KeyW", {ctrlKey: false, altKey: true});
  expect(field.value, "abc def", "Alt+W leaves the text in place");
  expect(field.selectionStart === field.selectionEnd, true, "Alt+W deactivates the region");
  press("y", "KeyY");
  expect(field.value, "abc defabc def", "Ctrl+Y yanks copied region");

  reset("abc def", 2);
  press("x", "KeyX");
  press("h", "KeyH", {ctrlKey: false});
  expect(field.selectionStart === 0 && field.selectionEnd === 7, true, "Ctrl+X H selects the whole document");
  press("d", "KeyD");
  expect(field.value, "", "Ctrl+D deletes the selected region");

  reset("abcdef", 1);
  press(" ", "Space");
  press("e", "KeyE");
  press("x", "KeyX");
  press("x", "KeyX");
  expect(field.selectionStart === 1 && field.selectionEnd === 6 && field.selectionDirection === "backward",
         true, "Ctrl+X Ctrl+X exchanges cursor and mark");
  press("g", "KeyG");

  reset("one two one Two", 0);
  press("s", "KeyS");
  press("o", "KeyO", {ctrlKey: false});
  press("n", "KeyN", {ctrlKey: false});
  expect(field.selectionStart === 0 && field.selectionEnd === 2, true, "Ctrl+S finds as you type");
  press("s", "KeyS");
  expect(field.selectionStart === 8 && field.selectionEnd === 10, true, "Ctrl+S again finds the next match");
  press("Enter", "Enter", {ctrlKey: false});
  expect(field.selectionStart === 10 && field.selectionEnd === 10, true, "Enter leaves cursor after match");

  reset("one two one Two", 15);
  press("r", "KeyR");
  press("t", "KeyT", {ctrlKey: false});
  press("w", "KeyW", {ctrlKey: false});
  expect(field.selectionStart, 12, "Ctrl+R searches backward ignoring case");
  press("r", "KeyR");
  expect(field.selectionStart, 4, "Ctrl+R again finds the previous match");
  press("g", "KeyG");
  expect(field.selectionStart === 15 && field.selectionEnd === 15, true, "Ctrl+G cancels search where it began");

  reset("one Two two", 0);
  press("s", "KeyS");
  press("T", "KeyT", {ctrlKey: false, shiftKey: true});
  press("w", "KeyW", {ctrlKey: false});
  press("s", "KeyS");
  expect(field.selectionStart, 4, "Uppercase search matches case exactly");
  press("a", "KeyA");
  expect(field.selectionStart, 0, "Another command ends search and runs");

  reset("héllo world");
  press("ƒ", "KeyF", {ctrlKey: false, altKey: true});
  expect(field.selectionStart, 5, "Alt+F uses physical key on macOS");
  press("d", "KeyD", {ctrlKey: false, altKey: true});
  expect(field.value, "héllo", "Alt+D kills next word");

  reset("😀x");
  press("d", "KeyD");
  expect(field.value, "x", "Deletion preserves Unicode characters");
  press("/", "Slash");
  expect(field.value, "😀x", "Browser undo restores deletion");

  reset("abc");
  press("h", "KeyH");
  const controls = document.getElementById("browsered-controls").shadowRoot;
  const dialog = controls.querySelector('[aria-label="Browsered keybindings"]');
  expect(dialog.open, true, "Ctrl+H opens help");
  expect(controls.querySelectorAll("table tr").length, globalThis.__browseredEmacsKeys.bindings.length, "Help lists every binding");
  expect(controls.querySelectorAll("nav a").length + controls.querySelectorAll("#chatgpt-help, #claude-help").length, 3, "Claude, ChatGPT and Codex controls exist");
  press("k", "KeyK", {ctrlKey: false});
  expect(dialog.open, true, "Ctrl+H K keeps keybindings open");
  expect(dialog.textContent.includes("Ctrl+H, then R"), true, "Help includes AI-key sequences");
  press("g", "KeyG");
  expect(dialog.open, false, "Ctrl+G closes help");
  expect(document.activeElement, field, "Help returns focus to editor");

  globalThis.__browseredEmacsKeys.toggle();
  field.setSelectionRange(2, 2);
  press("a", "KeyA");
  expect(field.selectionStart, 2, "Disabled bindings leave browser behavior alone");
  globalThis.__browseredEmacsKeys.toggle();
  press("a", "KeyA");
  expect(field.selectionStart, 0, "Re-enabling restores bindings");

  document.getElementById("results").textContent = results.join("\n") + `\n\n${results.length} checks passed`;
} catch (error) {
  document.getElementById("results").textContent = results.join("\n") + "\nFAIL " + error.message;
}

// Scheme scripting: femtoscheme in WebAssembly, after it has loaded.
(async () => {
  const scheme = globalThis.browseredScheme;
  if (!scheme) return;
  const output = document.getElementById("results");
  const schemeResults = [];
  const check = (actual, expected, description) => {
    if (actual !== expected) {
      throw new Error(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    schemeResults.push(`PASS ${description}`);
  };
  const status = () => document.getElementById("browsered-controls").shadowRoot
    .querySelector(".status").textContent;
  try {
    check(await scheme.whenReady, true, "Scheme starts");
    check(scheme.eval("(+ 1 2)").value, "3", "Scheme evaluates an expression");
    check(scheme.eval("(map (lambda (x) (* x x)) '(1 2 3))").value, "(1 4 9)", "Scheme lists and lambda");
    check(scheme.eval("(car 1)").ok, false, "Scheme reports errors");

    reset("hello world", 5);
    check(scheme.eval("(point)").value, "6", "Positions count from 1");
    scheme.eval('(goto-char (point-max)) (insert "!")');
    check(field.value, "hello world!", "insert at point");
    scheme.eval("(goto-char 1) (search-forward \"world\") (delete-region (match-beginning) (point))");
    check(field.value, "hello !", "search-forward and delete-region");
    scheme.eval('(goto-char 1) (insert "a") (insert "b")');
    press("/", "Slash");
    check(field.value, "hello !", "One undo reverts a whole Scheme command");

    reset("x\u{1F600}y", 0);
    check(scheme.eval("(begin (goto-char 3) (char-after))").value, "#\\y", "Emoji count as one character");

    scheme.eval('(global-set-key "C-c z" (lambda () (insert "Z")))');
    reset("ab", 1);
    press("c", "KeyC");
    press("z", "KeyZ", {ctrlKey: false});
    check(field.value, "aZb", "global-set-key binds a key sequence");

    reset("(* 6 7)", 7);
    press("x", "KeyX");
    press("e", "KeyE");
    check(field.value, "(* 6 7) 42", "Ctrl+X Ctrl+E inserts the value after the expression");
    check(status(), "42", "Ctrl+X Ctrl+E also shows the value");
    reset("(string-append \"a\" \"b\") ", 26);
    press("x", "KeyX");
    press("e", "KeyE");
    check(field.value, "(string-append \"a\" \"b\") ab", "Strings are inserted without quotes");

    scheme.eval("(define-command (test-command) (insert \"T\"))");
    check(scheme.commands.has("test-command"), true, "define-command registers M-x commands");
    reset("", 0);
    scheme.runCommand("test-command");
    check(field.value, "T", "Commands run by name");
    output.textContent += "\n\n" + schemeResults.join("\n") + `\n\n${schemeResults.length} Scheme checks passed`;
  } catch (error) {
    output.textContent += "\n\n" + schemeResults.join("\n") + "\nFAIL " + error.message;
  }
})();
