# Instructions for the generative AI assisting the user

Read README.md first: it says what Browsered is and how it is used. This
file says how to work on it.

## What Browsered is

Browsered is Schememax (sbcl-rasp, `schememax/`) compiled to WebAssembly
with Emscripten. Its C core, femtoscheme and Scheme scripts are
Schememax's. What is Browsered's own:

| File | Role |
|---|---|
| `src/web.c` | the screen layer (screen.h) for the page: a grid of cells handed to the page; `screen_getch` waits for the page through Asyncify; a key value of -2 means "the page has Scheme to run" (`web_take_eval`) |
| `src/web-main.c` | `main(void)`: passes the page's arguments to app.c's main (compiled as `app_main`), calls `web_ended` after C-x C-c; a `posix_spawnp` that fails (no processes in a page) |
| `src/web-scheme.c` | `(web-call NAME ARG)`: Scheme calls `Module.browsered.call(NAME, ARG)` in the page and waits for its string (or #f) |
| `web/shell.html` | the page: the canvas, the hidden `#keys` text field, the `#notice` banner |
| `web/browsered.js` | the page's side: painting, keys, mouse, clipboard, HOME in IndexedDB, folders of the computer, the APIs, banners, `?reset` |
| `scheme/extensions/web.scm` | Browsered's commands and overrides; harmless in Schememax (it checks `(in-browser?)`) |
| `src/web-sdl.c`, `web/sdl/`, `web/irene-dixe-pre.js` | irene-dixe (Schememax's, unchanged) on a canvas; a module of its own, `build/irene-dixe.js` |
| `web/vendor/` | pdf.js, for TTFY |
| `tests/web-test.js` | `make check-web` |
| `tools/` | `make sync`, Schememax's versions of the files changed here, and the optional C Codex bridge |
| `Browsered.command` | macOS/Linux launcher for the user's signed-in Codex allowance; serves the same HTML on loopback |

## The rules

- **Start in the advanced canvas editor, as requested by the user.**
  Writing / Grammarly opens a visible textarea for the current buffer;
  browser writing tools cannot check text painted on the canvas. Keep
  that optional interface in web.scm and browsered.js.
  Never write a document to disk merely because it was typed or corrected;
  saving still requires the user's explicit Save action.

- **Stay Schememax.** Change the editor in Schememax and bring it here
  with `make sync` (from GitHub, FemtoEmacs/sbcl-rasp; never from the
  user's own folders). Do not change Schememax's C core or
  scripts here. The only Schememax files changed are `src/native.c`,
  `src/primitives.c` and `femtoscheme/llt/dirpath.c`, by a few lines each;
  `tools/schememax-base/` has the versions those lines went into. A
  change the browser needs in another Schememax file goes into Schememax
  itself, or into `web.scm` as an override.
- **One page for every system.** `Browsered.html` serves macOS, Windows
  and Linux. At the user's explicit request, subscription-backed Codex now
  has an optional local C bridge and macOS/Linux launcher. Do not replace
  it with a paid OpenAI API fallback or move CLI credentials into the page.
- **Basic editing needs only a browser.** The optional Codex launcher
  needs an installed CLI signed in with ChatGPT and cc for its first build.
  Developers need Emscripten, cc and make;
  node and playwright only for `make check-web`. No Python, conda,
  Haskell, Quicklisp, Roswell, ASDF, C++, Flatpak or Snap.
- **After every change:** `make`, `make check`, `make check-web`, all
  passing, and the rebuilt `Browsered.html` kept with the sources.
  Run `make check-codex-bridge` after bridge changes; it uses a fake CLI,
  never real credentials or paid API calls. Node remains development-only.
- **Backups** of edited files go in a `bkp/` folder beside the file
  (`web/bkp/browsered.before-<what>-<date>.js`), never beside the file.
- **In Lisp**, do not muffle warnings; use `declaim` declarations.

## How things work, and what has bitten before

- **Folders are writable by default, as requested by the user.** Explicit
  `M-x forbid-saving` enables protection for debugging; `M-x allow-saving`
  restores writes. Keep protection checks in `FS.open`, `FS.close`, and
  `writeBack`, and test both the default and explicitly protected states.
- **Never write to the user's computer except on an explicit save.** On
  2026-10-29 an earlier Browsered emptied 14,797 files of ~/csand: the
  empty node it made for each listed file was closed as if saved, and
  written back. Now `listing` suppresses write-back, `writeBack` refuses
  an empty file over a non-empty one, and web-test.js checks that listing
  writes nothing. Keep all three. Test any change to the file code with a
  folder whose files would be missed (the fake folder records every
  write), never against the user's real folders.

- **Waiting in C.** The core is a loop that calls `screen_getch`. In the
  page, that call suspends the WebAssembly program (Asyncify) until the
  page has a key. The Asyncify stack (`ASYNCIFY_STACK_SIZE`, 4 MB) must
  hold femtoscheme's stack: a small one gives "RuntimeError: unreachable"
  when Scheme waits (web-call, reading a key from Scheme).
- **Scheme in the page.** Never call into the WebAssembly program from a
  page event while it is suspended. To run Scheme from the page, use
  `runScheme(expr)`: it queues the expression and pushes -2, and
  `screen_getch` runs it on the editor's own stack.
- **`main`.** Emscripten 3.1.6 (Ubuntu's) does not run a
  `main(int, char **)`; hence `main(void)` in web-main.c and
  `-Dmain=app_main` for app.c. Newer Emscripten (Homebrew) does not mind.
- **32 bits.** WebAssembly here is 32-bit: femtoscheme's fixnums hold
  less than 2^29. Anything that can be large (file times, sizes) goes
  through `return_from_int64`.
- **Typing.** Printable text arrives through the hidden `#keys` text
  field (`input` and `compositionend` events), never from `keydown`:
  dead keys (Brazilian keyboard, US International) only compose there.
  `keydown` handles Ctrl, Meta, Cmd and the special keys.
- **Folders.** A page sees only folders the user hands it, and may open
  the folder dialog only right after a key or a click. `ensure()` in
  browsered.js is called from TAB (through `file-name-completions` in
  web.scm, `askFolder`) and from RET (a failed `FS.lookupPath`, then the
  RET is replayed). Folders are listed a level at a time: never walk a
  whole tree, and never read or mount anything at start-up (csand is
  large; walking it once left a white page). A listed file is an empty
  node with the real size; `FS.open` reads it then (`loadLazy`), and
  `FS.close` of a written file writes it back to the computer.
- **HOME in IndexedDB.** IDBFS keeps `/home/web_user`. The folders of the
  computer are left out of it (`FS.readdir` filters them while
  `syncing`); never let them into the browser's storage.
- **femtoscheme details.** `io.write` takes one string; `message`
  concatenates its arguments (no format directives); a procedure kept by
  value (as `define-assistant` keeps one) is not replaced by redefining
  its name, so override what it calls.
- **File prompts** start with an editable remembered folder, never a fixed
  directory label. The web-only getfilename/line_edit wrappers preserve
  Schememax completion. Shell commands use the same-origin local helper;
  keep Host, Origin and custom Content-Type checks for its endpoints.
  Safari/Firefox use helper-backed file handles when native folder APIs
  are absent. Test file operations only against disposable fixtures.

- **Exiting.** A page cannot close a tab it did not open: after C-x C-c,
  `Module.browsered.ended()` hides the editor and shows a closed screen.
  Only its explicit Restart button reloads the editor; ordinary keys and
  clicks must not restart it.

- **Builtins cannot be replaced with set!.** ttfy-request,
  assistant-request, run-program and spawn-program are replaced in
  web-scheme.c (registered after Schememax's) by calls to web-...
  procedures of web.scm.
- **irene-dixe's end.** After Asyncify, main's return does not reach the
  page: web-irene-main.c calls `Module.onIreneExit` itself.
- **RET on a missing file directly in HOME** (a new file, a picture being
  saved) must never open the folder dialog: `ensure()` asks only for
  `~/folder/...` paths, or for a TAB on `~/fol`.

## Testing in the cloud

Ubuntu's `apt-get install emscripten` (3.1.6) builds Browsered;
Emscripten's own downloads may be blocked. Chromium and playwright are
preinstalled there; `make check-web` uses them. Look at what the page
shows with playwright screenshots; Chrome's folder dialog cannot be
driven, so web-test.js replaces `showDirectoryPicker` with a pretend
folder.

## Git

The human in the loop does not type git commands. Git mutations go through
`git/gitcommit.sh` and `git/gitpush.sh`, run from this folder. Write the
commit message in `git/next-commit.txt`; push only when explicitly asked.
This repository is https://github.com/FemtoEmacs/browsered. The older
textarea editor is preserved in its Git history. GitHub Pages publishes
the current WebAssembly editor through `.github/workflows/pages.yml`.
Stage only the public page with `web/build-site.sh`; never publish a
local helper server or any user's editor storage or credentials.

## Browser command interpreter

Hosted and standalone pages route shell requests to the limited JavaScript
interpreter (`ls`, `cd`, `pwd`, `help`), using the browser filesystem and
explicitly granted folders. Keep this read-only at the file-content level.
The local loopback page must continue to call `/shell` for full `/bin/sh`
commands, including external programs and pipes. Never silently downgrade
a failed local shell request to the limited interpreter. Test both routes.

C-c m opens the native minibuffer through web-scheme.c's command prompt,
with asynchronous path completion; Esc ! keeps the multiline command view.
Both share the current command directory, including full local shell cd
reported through the helper response header. C-c C-f aliases C-x C-f.
Do not reset an explicit cd just because the original file is elsewhere.
Test completion/cancellation and opening a relative filename after cd on
both hosted and local pages, including native paths outside browser HOME.
