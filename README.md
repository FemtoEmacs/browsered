# Browsered

Emacs keys in existing browser text fields. Click the extension once on an
editor page: its badge reads ON. Click again to turn the bindings off.
After reloading or opening another page, enable it again.

The existing textarea stays in place, so CPS-100 can check and correct it.
Supported fields: textareas and ordinary text inputs. Rich text editors,
password fields, and editors inside separate frames are outside this version.

## Open the editor

Double-click **Browsered.app**. It starts the native helper and opens Chrome.
No terminal, installed runtime, or compilation is needed. You can bookmark
http://127.0.0.1:8766/ once the app is running. Text saves in Chrome locally.
The file version keeps a separate draft; use Open and Save to transfer it.
**Open** (Ctrl+X Ctrl+F) visits a file chosen in Chrome's file picker.
**Save** (Ctrl+X Ctrl+S) writes back to that same file; Chrome asks once
for permission to change it. With no visited file, Save asks where to save.
Ctrl+X Ctrl+W saves to a new file. Where the file picker is unavailable
(for example outside Chrome), Open uses an upload dialog and Save downloads.
After reloading the page, Save asks for the file again. **Copy all** copies the whole document;
**Paste** inserts clipboard text at the cursor or replaces the selection.
Chrome may ask for clipboard access when you click Paste. The top toolbar has **Keybindings**,
**Claude**, **ChatGPT**, and **Codex** buttons.
Use **Ctrl+H R** for Claude, **Ctrl+H G** for ChatGPT, and **Ctrl+H K**
for keybindings (release Ctrl before the second key). **Ctrl+H** opens all bindings;
**Esc**, **Ctrl+G**, or **Ctrl+H** closes help and returns focus to the editor.
Claude (Ctrl+H R) and ChatGPT (Ctrl+H G) open an empty request box. Type your
request and click Enviar pedido e documento. Browsered sends the request and
current document to Anthropic through your existing Claude Code login, or to
OpenAI through your existing ChatGPT login. The response and file links
appear in this same box, without opening another window. PDF requests
produce a PDF from the assistant's final text. Keybindings lists the shortcuts.
Codex opens its page.

The Claude adapter runs the Claude Code CLI (`claude -p`) found in
`~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` or `/usr/local/bin`.
Install it and run `claude` once in Terminal to log in. File, shell and web
tools are disallowed, and it runs from an empty temporary directory, so
Claude sees only the request and the document. The ChatGPT adapter uses the
native Codex CLI bundled with the installed ChatGPT app, in read-only mode
without self-approval. Both return structured results that can include
PDF, text, Markdown, CSV, or HTML. Browsered creates these files locally.
It does not grant the assistant general filesystem write access.

## PDF and Markdown formatting

PDF artifacts retain Markdown formatting. The native renderer reads
`formatting.xml` for every PDF: page dimensions, margins, fonts, heading sizes,
alignment, indentation and spacing. The copy next to Browsered.app is editable;
the bundled copy is used when the app is moved by itself. Invalid or incomplete
rules stop PDF generation instead of silently reverting to plain text.

Supported formatting: headings 1–6, bold, italic, combined emphasis, ordered
and unordered lists (including nesting), block quotes, inline and fenced code,
tables, link labels, horizontal rules and explicit line breaks. Image contents
and raw HTML styling are outside this text renderer.

The assistant returns PDF content as Markdown. The renderer applies the XML
rules to the parsed Markdown; the assistant does not decide whether to apply
those rules. Both Markdown parsing and XML reading use macOS system libraries.

Run `./tests/run-pdf-tests.sh` to verify font styles, XML-driven page and heading
sizes, and rejection of missing or incomplete XML.

## Scheme scripting

Browsered is programmable in Scheme, the way Emacs is in Emacs Lisp. The
language is femtoscheme (in `femtoscheme/`): a subset of R7RS-small derived
from femtolisp, compiled to WebAssembly and built into the page, so nothing
needs installing. See `femtoscheme/README.md` for the language itself.

| Keys | Action |
|---|---|
| Alt+: (M-:) | Evaluate an expression; the value appears in the status line |
| Ctrl+X Ctrl+E | Evaluate the expression before the cursor and insert its value after it: `(* 3 4 5)` becomes `(* 3 4 5) 60` |
| Alt+X (M-x) | Run a command by name; Tab completes, ↑/↓ recall history |
| Ctrl+H E | Messages: output, results and errors |

M-x `eval-and-replace` replaces the expression by its value instead, and
M-x `eval-last-sexp-show` only shows it. M-x `eval-buffer` evaluates the
whole document and `eval-region` the selection. `init.scm` (next to Browsered.app) is loaded when the editor opens;
change it and run M-x `load-init-file`. It has examples:

```scheme
(define-command (duplicate-line)
  (let ((line (current-line)))
    (end-of-line)
    (insert "\n" line)))
(global-set-key "C-c d" 'duplicate-line)
```

The editing API follows Emacs Lisp. Positions count characters from 1, so
`(point-min)` is 1, and an emoji counts as one character.

- Point and text: `point`, `point-min`, `point-max`, `goto-char`,
  `forward-char`, `backward-char`, `insert`, `delete-region`, `delete-char`,
  `buffer-substring`, `buffer-string`, `char-after`, `char-before`,
  `erase-buffer`, `bobp`, `eobp`.
- Lines: `beginning-of-line`, `end-of-line`, `line-beginning-position`,
  `line-end-position`, `forward-line`, `goto-line`, `line-number-at-pos`,
  `current-line`.
- Mark and region: `mark`, `set-mark`, `region-beginning`, `region-end`,
  `region-text`, `use-region-p`, `deactivate-mark`, `save-excursion`.
- Searching: `search-forward`, `search-backward`, `re-search-forward`,
  `re-search-backward`, `looking-at`, `string-match`, `match-beginning`,
  `match-end`, `match-string`, `replace-match`, `replace-string`,
  `replace-regexp`, `regexp-replace`. Regular expressions use JavaScript
  syntax, with flags such as `"i"` and `"m"`; in a Scheme string the
  backslash is doubled: `(re-search-forward "\\d+")`.
- Interaction: `message` and `format` (`~a ~s ~%`, also `%s %d`),
  `read-from-minibuffer`, `read-number`, `y-or-n-p`.
- Commands and keys: `define-command`, `global-set-key`, `global-unset-key`,
  `key-binding`, `execute-command`, `command-names`. Keys use Emacs
  notation: `C-` Ctrl, `M-` Alt, `s-` Command, `S-` Shift, and names such as
  `RET`, `TAB`, `SPC`, `<f5>`; sequences are written `"C-c d"`.
- Also: `kill-new`, `current-kill`, `kill-region`, `undo`, `find-file`,
  `save-buffer`, `write-file`, `buffer-file-name`, `eval-string`.

A Scheme command edits the document as one change, so one Ctrl+/ undoes it.
Scripts run only in the Browsered editor page, not through the extension.

## Use it in Edge or Chrome (Windows, Linux, ChromeOS)

The editor also runs as a web page, with nothing to install: femtoscheme is
WebAssembly inside the page. GitHub Pages publishes it from this repository
(`.github/workflows/pages.yml`) at `https://<user>.github.io/browsered/`.
In Edge, choose **Apps > Install Browsered** (or the install icon in the
address bar) to get its own window, a Start menu entry and offline use.

Without Browsered.app the Claude and ChatGPT buttons open those websites,
and there is no PDF generation. Open and Save use Edge's file dialogs. The
init file lives in the browser: M-x `choose-init-file` loads one from disk,
M-x `use-buffer-as-init` makes the text you are editing the init file, and
M-x `forget-init-file` returns to the example `init.scm`.

On Windows, browsers keep a few Ctrl shortcuts for themselves in a tab
(Ctrl+N, Ctrl+T, Ctrl+W); the installed app window may pass more of them to
the editor.

To build the site locally: `sbcl --script build-standalone.lisp`, then
`web/build-site.sh site`.

## Install the optional extension

In Chrome, open `chrome://extensions`, enable Developer mode, choose
**Load unpacked**, and select this folder. Pin **Browsered — Emacs keys**
from the Extensions menu. Open your plain text editor and click Browsered.
It asks only for `activeTab` and `scripting`: access to a page you enable.

## Bindings

| Keys | Action |
|---|---|
| Ctrl+A / E | Start / end of logical line |
| Ctrl+B / F | Previous / next character |
| Ctrl+P / N | Previous / next logical line, retaining column |
| Alt+B / F | Previous / next word |
| Alt+< / > | Start / end of text |
| Ctrl+Space or Ctrl+@ | Set mark; movement then extends the selection |
| Ctrl+X Ctrl+X | Exchange cursor and mark |
| Ctrl+X H | Select the whole document |
| Ctrl+G | Cancel mark or search |
| Ctrl+K | Kill to line end; at line end, kill newline |
| Ctrl+W / Alt+W | Kill (cut) / copy selection |
| Alt+D / Alt+Backspace | Kill next / previous word |
| Ctrl+Y | Yank (paste) |
| Ctrl+D / Backspace | Delete next / previous character, or the selection |
| Ctrl+S / Ctrl+R | Incremental search forward / backward |
| Ctrl+X Ctrl+F | Open file |
| Ctrl+X Ctrl+S / Ctrl+X Ctrl+W | Save / save to a new file |
| Ctrl+H | Open / close help |
| Ctrl+H R / G / K | Claude / ChatGPT / keybindings |
| Esc (in help) | Close help |
| Ctrl+/, Ctrl+_ or Ctrl+X U | Browser undo |
| Ctrl+L | Center current logical line |

Kills and copies also go to the system clipboard, so other programs can
paste them. Ctrl+Y pastes text copied in another program when it is newer
than the last kill; Chrome asks once for permission to read the clipboard,
and refusing keeps Ctrl+Y on the internal kill buffer.

Incremental search follows Emacs: type to extend the query, Ctrl+S / Ctrl+R
for the next / previous match (again after a failure to wrap around),
Backspace to shorten it, Enter or any other command to stop there, and
Ctrl+G to return to where the search began. A lowercase query ignores case.
An empty Ctrl+S repeats the last search.

Successive kills concatenate. Typing, clicking, or another command ends
the sequence. Shift with movement extends the selection. Command shortcuts
and normal typing stay with the browser. On a Kinesis, use its Alt key for
Alt bindings. Ctrl+Space may conflict with macOS input-source switching;
Shift with movement provides another way to select text.

Browsered.app serves the editor on this computer using a small native C
program. CPS-100 checks this local web page. Browsered.html also opens directly
for offline editing. The optional extension adds bindings to an online editor.

For development, `./build-native.sh` rebuilds the app using the installed
macOS C compiler and SBCL. With Emscripten (`brew install emscripten`) it
also rebuilds femtoscheme's WebAssembly; otherwise it uses the prebuilt
`femtoscheme/wasm/femtoscheme.js`. Sources have no third-party libraries.
`browsered.c` implements the launcher and serves only listed assets on
127.0.0.1. Text stays in Chrome; the helper receives the document only when
you send a request to Claude or ChatGPT.

## Check

Open `http://127.0.0.1:8766/browser-tests.html` for the checks of navigation and edits,
input events, undo, help, focus, toggling and Scheme scripting. Browser edits use Chromium's `execCommand` to retain
native undo; a range replacement fallback sends input events to the page.
The fallback cannot preserve native undo in browsers without that command.
The native helper serves local assets. No document collection or third-party libraries.
