# Browsered: Schememax in the browser

Browsered is the Schememax editor running inside a web browser. It has
the same Emacs keys, the same menus on the mode line, the same help page,
colours, indentation and assistants, and the same Scheme scripts that
customize it. It is one file, `Browsered.html`, that opens in any recent
browser on macOS, Windows or Linux, with nothing to install and nothing
to build.

To use your **Codex subscription allowance**, launch `Browsered.command`
instead of opening the HTML directly. It uses the installed, ChatGPT-signed-in
Codex CLI through a small local bridge; it does not use OpenAI API credits.

## Contents

1. [Starting](#starting)
2. [How it works](#how-it-works)
3. [Keys](#keys)
4. [Files and folders](#files-and-folders)
5. [Settings and scripts](#settings-and-scripts)
6. [Assistants](#assistants)
7. [Textify a PDF (C-c f) and plots (C-c p)](#textify-a-pdf-c-c-f-and-plots-c-c-p)
8. [What the browser does not allow](#what-the-browser-does-not-allow)
9. [When something goes wrong](#when-something-goes-wrong)
10. [Building and testing](#building-and-testing-development-only)
11. [Layout](#layout)
12. [Staying close to Schememax](#staying-close-to-schememax)
13. [Notice](#notice)

## Starting

[Run Browsered in your browser](https://femtoemacs.github.io/browsered/).
The hosted editor starts immediately; no installation or account is needed.
Chrome and Edge can open and save folders through their browser picker.
Safari can edit uploaded files and download them; direct folder saving,
the full system shell and your Codex subscription require the local launcher.
The hosted editor includes `ls`, `cd`, and `pwd` for its browser filesystem.

For the full local version, [download the source](https://github.com/FemtoEmacs/browsered/archive/refs/heads/main.zip)
or clone this repository, then run `Browsered.command` (macOS/Linux).
The launcher needs a C compiler (`cc`) and an installed Codex CLI signed
in with ChatGPT. You do not need Emscripten or Node.js to use it.


For Codex, double-click **Browsered.command** on macOS, or run
`./Browsered.command` / `make run` on macOS or Linux. Use the local page
it opens and keep the launcher running.

Once the launcher is running, opening `Browsered.html` normally also takes
you straight to the connected local page. This includes opening the file
from a bookmark or browser menu. For deliberate offline editing, open
`Browsered.html?standalone`; Codex is unavailable in that mode.

Chrome and Edge use their folder picker. Safari and Firefox use the local
helper for opening and saving files and folders: start Browsered.command,
then use its local page. Safari can be started from Terminal with
`open -a Safari http://127.0.0.1:8767/`.

The editor starts in the advanced Scheme/Emacs interface; C-h or F1 shows
its keys. Click Writing / Grammarly to edit the current buffer in a normal
text field with Grammarly support. Its Advanced editor button returns to
the main editor.

## How it works

An editor such as Schememax has three layers:

1. **The core**, written in C: buffers, windows, the cursor, searching,
   the prompt at the bottom (the minibuffer), and the loop that reads a
   key and runs its command.
2. **The scripts**, written in Scheme and run by femtoscheme, a small
   Scheme bundled with the editor. They define almost everything you see:
   the key bindings, the commands, indentation, colours, the menus, the
   help page, the assistants.
3. **The screen.** The core does not draw by itself. It writes characters
   into a grid of cells, like the cells of a terminal, and a screen layer
   puts that grid in front of you and returns the keys you press.
   Schememax has two screen layers: `term.c` for a terminal and `gui.c`
   for a window of its own.

Browsered keeps the C editing core and adds a third screen
layer, `src/web.c`, plus a compiled Scheme execution path. The whole program, core and femtoscheme together, is
compiled to WebAssembly, a machine language that every modern browser
runs at nearly native speed. The page (`web/browsered.js`) paints the grid
of cells on a canvas and sends each key back as the bytes a terminal would
send, so the core cannot tell a browser from a terminal.

The Scheme scripts and femtoscheme's own image are packed into the same
file, which is why `Browsered.html` is all you need.

## Compiled Scheme

Browsered includes Schemer, the Chez-inspired Scheme compiler, and the
self-hosted WasmGC compiler seed. Schemer compiles Scheme to WasmGC
inside the page without a second FemtoScheme compiler VM; no compiler installation or server is needed. Compatible
Scheme command bodies compile on first invocation and retain their compiled
procedures for later calls. `C-x C-e`, `C-M-x`, and `M-:` use the same route
for compatible expressions and procedure definitions. `M-x schemer-status`
shows compiled execution counts and compatibility handlers.

Schemer and the older editor dialect are not completely compatible. Legacy
macros, native ports and tables, higher-order editor callbacks, multiple-value
native calls, and shared mutable editor objects keep explicit femtoscheme
compatibility handlers. Top-level data definitions also use that environment
so existing scripts can share their state. This is a staged integration:
the editor core still runs FemtoScheme. It does not compile every existing
editor script or make C editing primitives
faster. Ordinary Scheme functions, including recursive functions, execute as
compiled WebAssembly and can call editing primitives and interactive prompts.

Compiled editor callbacks need WebAssembly JSPI (`WebAssembly.Suspending`
and `WebAssembly.promising`). When those APIs are absent, the editor keeps
its compatibility execution path. `M-x schemer-eval-buffer` explicitly runs
a buffer as a compiled Scheme program; this requires WasmGC, and editor
callbacks additionally require JSPI. Compiled R7RS text file ports share the
editor filesystem and its existing save protection; file deletion through
compiled ports is currently unsupported.

The vendored compiler lives in `schemer/`; its source and integration details
are described in [schemer/README.md](schemer/README.md).

## Keys

File prompts prefill an editable folder, initially `~/`. The last accepted
folder is remembered across prompts and reloads. Append a filename, erase
the prefix with Backspace, or use C-u to clear it and enter another path.
TAB completion remains available.

The keys are Schememax's. Notation: **C-x** means Ctrl-x; **M-x** means
Alt-x (Option-x on a Mac), or Esc followed by x.

The keys used most:

| Keys | What they do |
|---|---|
| C-h, F1 | the page of every key (i or [CLOSE] closes it) |
| C-x C-f, C-c C-f | open a file in the current folder (TAB completes the name) |
| C-x C-s | save |
| C-x C-w | save as |
| C-x b | switch to another buffer |
| C-x d | list a folder |
| C-SPC, C-w, M-w, C-y | mark, cut, copy, paste |
| C-/ | undo (C-M-_ redoes) |
| C-s, C-r | search forward, backward |
| M-x | run a command by name |
| C-x C-e | evaluate the Scheme expression before the cursor |
| C-x C-r | load the scripts again after editing them |
| C-c r, C-c g | ask Claude, ask ChatGPT |
| C-c m | command in the minibuffer; TAB completes paths, Enter runs it, C-g cancels |
| C-x C-c | end the editor |

The mode line is a menu: click [SAVE], [UNDO], [Select], [MORE] and the
rest. The mouse moves the cursor, a drag selects, and the wheel scrolls.

On a Mac the usual Cmd keys also work: Cmd-C copies, Cmd-X cuts, Cmd-V
pastes, Cmd-Z undoes (Shift-Cmd-Z redoes) and Cmd-S saves. Cmd-+ and Cmd--
(Ctrl-+ and Ctrl-- elsewhere) change the size of the letters. Kills and
copies go to the system clipboard, and pasting from other programs works
with Cmd-V or Ctrl-V.

Accents and the tilde typed with dead keys (a Brazilian keyboard, US
International, Option-n on a Mac) arrive composed, as in any other text
field. Since Option is Meta, Option combinations do not type characters;
put `(set! *option-is-meta* #f)` in your init file if you want them back
(see [Settings and scripts](#settings-and-scripts)).

## Files and folders

The editor sees an ordinary file system, as on a computer, but the browser
keeps it. It has two kinds of place.

**HOME** (`~`, which is `/home/web_user`) is kept by the browser itself,
in its own storage for this page. A file saved there (C-x C-w
`~/notes.md`) is there the next time you open Browsered, in this browser
on this computer. Your settings live there too, in `~/.schememax/`.

**The folders of your computer.** A web page may not read your disk by
itself: it sees only folders you hand it, and the browser asks you to
hand them over only right after a key press or a click. Browsered asks at
the moment a folder is needed:

1. Type the path as on your computer: `C-x C-f ~/csand/brow`, then TAB.
2. The first time, choose the csand folder. Chrome/Edge show a folder
   picker; Safari/Firefox ask for its path, such as `~/csand`, and access
   it through the local helper. TAB then completes normally.
3. Open, edit and save. Folders are writable by default; only an explicit
   Save writes your changes back to the computer. For debugging, M-x
   forbid-saving protects the current folder (or individually opened file)
   until the page is closed. M-x allow-saving restores writing.
   The browser may still request its own filesystem permission.

Each folder is asked for once. The browser remembers the folders you gave;
after it restarts it may ask again, with a single click, the first time
the folder is needed. Folders are read a level at a time, as you go into
them, so even a large tree opens at once. Folders whose names begin with a
dot (`.git`) and `node_modules` are not listed.

C-c o (M-x open-folder) gives a folder right away and lists it. Only
Chrome and Edge use their folder picker; Safari and Firefox ask for the
folder path through the local helper. The helper must be running.

**Single files**, without a folder: drop a file on the window, or M-x
open-computer-file. It is copied into HOME and opened. M-x download-file
saves the buffer and downloads its file.

## Settings and scripts

Your settings go where Schememax keeps them, in HOME:

| File | Loaded |
|---|---|
| `~/.schememax/init.scm` | last, at start-up |
| `~/.schememax/languages/*.scm` | your own languages |
| `~/.schememax/extensions/*.scm` | your own commands and keys |

For example, in `~/.schememax/init.scm`:

```scheme
(global-set-key "C-c d" 'insert-day)       ; Emacs key notation
(set-color 'comment 244)                   ; a face, 0-255 or "#rrggbb"
(set! *fill-column* 78)
(set! *gui-theme* 'light)                  ; or M-x light-theme
(set! *option-is-meta* #f)                 ; Mac: Option types accents
```

Open it with C-x C-f `~/.schememax/init.scm`, edit, save, and press C-x
C-r: the scripts load again, with no rebuild and no reload of the page.

The editor's own scripts are inside `Browsered.html`. To change them for
everybody, change them in Schememax and bring them over (see
[Staying close to Schememax](#staying-close-to-schememax)).

## Assistants

**C-c g uses your Codex allowance.** On macOS or Linux, run
`./Browsered.command` from this folder (on Mac, double-click it). It builds
the optional bridge with the C compiler on first launch and opens
`http://127.0.0.1:8767/`. Keep its terminal running. Alternatively use
`make run`. Sign into the installed Codex CLI with ChatGPT (`codex login`)
if needed. `BROWSERED_CODEX` can specify another Codex executable.

The bridge checks for ChatGPT sign-in, removes inherited API credentials,
and runs `codex exec` in a private temporary workspace, read-only and
ephemeral. Prompts and rendered PDF pages go to Codex; the login credentials
stay in the CLI. Only the bridge's own local page can submit requests.
There is no OpenAI API fallback, including when an old API key is saved.
`M-x codex-status` explains the connection. C-x C-c in Browsered stops the
launcher too, and its Terminal window closes (macOS may ask once to let
Terminal control Terminal); Ctrl-C in its terminal also stops it.

**Claude uses your Claude subscription** through the same launcher. Install
Claude Code and log in once in a terminal (`curl -fsSL
https://claude.ai/install.sh | bash`, then `claude`); a Pro, Max, Team or
Enterprise plan is needed. Started from `Browsered.command`, the page asks
Claude Code exactly as Schememax does (`claude -p`, no tools, no saved
session), and the bridge removes inherited Anthropic API credentials, so
the subscription is what is used. `BROWSERED_CLAUDE` can specify another
`claude` executable; the terminal that starts the launcher says which one
it found. `M-x assistant-status` shows the connection. Without the
launcher (an HTML file opened directly), Claude needs an API key: `M-x
set-claude-key`.

The local page has its own browser storage, separate from an HTML file
opened directly. Open your computer folders again as needed. Files stored
only in the old page's HOME can be downloaded there and opened in the local
page; changing launch modes does not delete them.

**C-c r still uses Anthropic's API.** Configure it with
`M-x set-claude-key`, paste the key into the masked field, then press Enter
or **Save key**. Escape or **Cancel** preserves the previous key. The key
is stored in this browser and sent only to Anthropic.

Hints, questions, discussions, C-c y and C-c t work as in Schememax.

## Grammarly

**Every file opens in the editor itself**, prose too, with all of its keys,
windows (C-x 2) and mode-line buttons. Grammarly checks only text fields of
a page, never the canvas, so it stays quiet while you write. When you want
a check, press **[GRAMMAR]** on the mode line (or `C-c d`): an invisible
text field with the window's text is laid exactly over the window, and
Grammarly underlines the editor's own text, where it is, at its size. You
keep editing as always (the keys still go to the editor). A suggestion you
accept becomes one change of the buffer, undone by one `C-/`. **[GRAMMAR]**
again ends the check and the field goes away; so does showing another
buffer. Only prose is checked (files that word-wrap: Markdown, TeX, text),
never programs. Nothing is saved until you save.

Should Grammarly stay silent, `M-x grammarly-status` says whether it is in
the page and whether it took the field, and `M-x grammarly-show-field`
paints the field's letters in red over the editor's (again: hidden).

How: `src/web-layer.c` tells the page, at each redisplay, the window's
rows and text; `textLayer` in `web/browsered.js` is the field;
`toggle-grammarly` and `web-layer-edit` in `scheme/extensions/web.scm`
start the check and apply corrections.

The old writing view (a whole editor in a text field) is still there as
`M-x document-editor`, but nothing opens it any more.

Open chooses a file. Save writes it without a separate Browsered permission
prompt, unless you explicitly enabled protection. ChatGPT opens a request field and shows
the Codex reply below your document without replacing it. Quit asks before
discarding unsaved changes.

The canvas is the default startup view; `?advanced` remains compatible.
`M-x writing-mode` remains an optional temporary draft view, with Apply
and Cancel; `M-x document-editor` opens the Grammarly-compatible document interface.

## Speed

Typing in a large LaTeX file takes about 4 ms a key, as in a program
file (it took 127 ms). The colours of LaTeX and the rows of wrapped prose,
worked out again at every key, run in C in the browser
(`src/web-fast.c`), giving exactly what the Scheme in `tex.scm` and
`markdown.scm` gives; `M-x scheme-highlighting` switches to the Scheme
and back, to compare.

## Textify a PDF (C-c f) and plots (C-c p)

**C-c f** works as in Schememax: choose ChatGPT or Claude, the PDF and the
pages. Schememax renders the pages with macOS's Quartz; Browsered renders
them in the page with pdf.js (Mozilla's PDF renderer, bundled in
`Browsered.html`), at the same 144 dpi, and sends them as images through
the chosen assistant: Codex uses the local subscription bridge, while Claude
uses its configured API key (Claude Code through the bridge takes no images). The Markdown opens in
a new buffer, with every table as an S-expression, as in Schememax.

**C-c p** on an `(estimator-plot ...)` or `(data-table ...)` opens
irene-dixe's window over the editor: the same program as Schememax's
(`src/irene-dixe.c`), compiled to WebAssembly, drawing with the page's
fonts. In it, s saves the picture beside your file (`paper-plot-1.png`), q
or Esc closes it; M-x plot-save saves without a window.

## What the browser does not allow

- **Commands** (Esc ! or M-!, then C-c s): on GitHub Pages or in standalone
  HTML, a small browser interpreter supports `ls [-ald] [path ...]`,
  `cd [path|-]`, `pwd`, and `help`. It reads the editor's browser filesystem,
  including folders you choose in Chrome/Edge. Quotes, `;`, and `&&` work;
  system programs, pipes, redirection, variables, and glob expansion do not.
  `cd` keeps its folder across commands and updates both file-opening
  bindings, C-x C-f and C-c C-f. Use C-c m for a one-line command with
  TAB completion (directories for cd, files and directories for ls).
  Enter runs it and shows its output; C-g cancels. Esc ! retains the
  multiline command window.
  For example: `cd "~/papers/draft notes" && ls -l`.
  Through Browsered.command, the same interface always uses the full
  `/bin/sh` on your computer, including pipes and external programs.
  A successful local cd is remembered for subsequent commands and file
  prompts too. Browser folders under `~/` map to your computer's home folder. If the
  local helper stops, it reports that error rather than switching modes.
- **Ctrl-W, Ctrl-T and Ctrl-N** belong to Chrome and Edge on Windows and
  Linux, which do not pass them to a page. There, to kill the region,
  click [DELETE] on the mode line (it appears when text is selected) or
  use M-x kill-region. On a Mac they are free, since the browser uses Cmd.
- **Closing the tab.** A page may not close a tab you opened. After C-x
  C-c shows a closed screen: close the tab with Cmd-W or Ctrl-W,
  or click **Restart Browsered** to explicitly start another session.

## When something goes wrong

- **A red banner** at the top reports an error of the page. Its text says
  what failed.
- **Nothing appears** after 15 seconds: a banner says so. Open
  `Browsered.html?reset` (add `?reset` at the end of the address). It
  starts without what the browser kept (the files in HOME and the folders
  given), and the page loads clean.
- **A file changed on your computer** while it was open in Browsered is
  not reread: open it again (C-x C-v).
- **A folder was refused** in the dialog: Browsered does not ask for it
  again until the page is reloaded.

## Building and testing (development only)

Users need nothing but a browser. Developers need Emscripten (which
compiles C to WebAssembly), cc and make:

```
make             # Browsered.html (macOS: brew install emscripten)
make check       # femtoscheme's suites and the editor's 231 tests
make check-web   # the page in a headless Chrome (node and playwright)
make sync
make clean
```

`make` without Emscripten only says that `Browsered.html` is built
already. `make check` compiles the same core for a terminal
(`browsered-term`, with cc and curses) and runs Schememax's tests on it,
with Browsered's own script loaded. `make check-web` opens the page in a
headless Chrome and checks start-up, Scheme, dead keys, HOME across a
reload, folders (with a pretend folder dialog), saving back, the API (with
a pretend answer) and the help page.

After a change, run all three and keep the rebuilt `Browsered.html` with
the sources: it is what users open.

## Layout

| Path | Contents |
|---|---|
| `Browsered.html` | The editor, built: what users open |
| `src/` | Schememax's C sources, plus the browser's: `web.c` (the screen layer), `web-main.c` (start and end), `web-scheme.c` (`web-call`, Scheme's door to the page, and the browser's ttfy-request, assistant-request, run-program, spawn-program), `web-sdl.c` and `web-irene-main.c` (irene-dixe on a canvas) |
| `web/sdl/` | The part of SDL2 and SDL_ttf that irene-dixe uses, for `web-sdl.c` |
| `web/irene-dixe-pre.js` | irene-dixe's window, pictures and events in the page |
| `web/vendor/` | pdf.js 3.11.174 (Apache 2.0 licence, `pdfjs-LICENSE`) |
| `web/shell.html` | The page around the program: the canvas, the hidden text field that receives typing, the banner |
| `web/browsered.js` | The page's side: painting, keys, mouse, clipboard, HOME, folders, the APIs, the banners |
| `femtoscheme/` | The bundled Scheme |
| `scheme/` | Schememax's scripts, plus `extensions/web.scm` (Browsered's commands, its start-up page, the assistants through the APIs, folders asked for by TAB) |
| `ttfy/` | Schememax's TTFY guidelines |
| `tests/` | Schememax's tests, and `web-test.js` for the page |
| `tools/sync-schememax.sh` | `make sync` |
| `tools/schememax-base/` | Schememax's versions of the three files Browsered changes |

## Staying close to Schememax

Browsered is meant to stay Schememax. Change the editor in Schememax,
then bring the change here:

```
make sync
make && make check && make check-web
```

Only three of Schememax's files carry a few lines for the browser:

| File | Why |
|---|---|
| `src/native.c` | registers `web-call` |
| `src/primitives.c` | file times as big numbers: WebAssembly is 32-bit, and today's times overflow femtoscheme's small integers |
| `femtoscheme/llt/dirpath.c` | where the page keeps femtoscheme's files |

`make sync` copies everything else and leaves these three alone. When
Schememax changes one of them, it says so, and the browser's lines are
carried over by hand (`tools/schememax-base/` holds the version they were
added to).

## Notice

**English.** This is not a product and must be used only to test the
software, Claude Code, Codex, OpenEvidence and the algorithms. Anyone who
wishes to develop the product for sale, distribution or their own use is
free to do so.

**Português (original).** Isto não é um produto e deve ser usado apenas
para testar o software, Claude Code, Codex, OpenEvidence e os algoritmos.
Se alguém quiser desenvolver o produto para venda, distribuição ou uso
próprio, sinta-se à vontade para fazê-lo.

femtoscheme derives from femtolisp by Jeff Bezanson (BSD licence,
`femtoscheme/LICENSE`); the editor core from Femto Emacs by Hugh Barney
(public domain).

`C-x C-w` (Save As) prefills the full current filename as an editable
path, abbreviating home as `~`, and TAB completes directories and filenames.
For unnamed buffers it starts at the normal remembered folder. Cancelling
preserves the current filename and does not save a file.

The Writing / Grammarly view uses a monospaced font, preserves tabs and spaces,
and scrolls horizontally instead of wrapping long lines. Its textarea supports
Emacs character/line movement (`C-b/f`, `C-a/e`, `C-p/n`), word movement (`M-b/f`),
mark (`C-SPC`), kill/yank (`C-k`, `C-w`, `M-w`, `M-d`, `M-Backspace`, `C-y`),
delete (`C-d`, `C-h`), undo (`C-/` or `C-_`), select all (`C-x h`), and
save (`C-x C-s`). Escape followed by a key also works for Meta commands.
Tab inserts a literal tab. This view implements these common editing keys;
the advanced editor retains the full command set. Changes return to the
current buffer; files are written only on an explicit Save.

In the Writing / Grammarly view, `C-s` opens incremental forward search (the
search line at the bottom) and
`C-r` searches backward. Repeat those keys for the next/previous match,
The document keeps keyboard focus and its cursor moves immediately before
each match. Repeated search does not require Enter. Movement/editing keys
accept the match and run immediately; Enter can also end search. `C-g`
cancels and restores the original cursor. Offscreen matches scroll into view.
`C-x C-s` remains Save. These search shortcuts are captured before ordinary
page-level snippet handlers; browser extensions with global shortcuts may
require changing their own shortcut assignment.

Writing-view navigation also includes `M-<` / `M->` (file start/end),
`Ctrl-Home` / `Ctrl-End`, and `C-v` / `M-v` (page down/up). On keyboards
where Option combinations are inconvenient, press Escape then `<` or `>`.
These movements scroll the cursor into view. A steady, thick, dark-red
caret makes the insertion position visible without replacing the textarea
that Grammarly uses; it hides when focus leaves the document or a region
is selected.

Shell commands in the `M-!` / `C-x @` window now support Tab completion
at the cursor, preserving any command text after it. Tab expands a common
prefix and repeated Tab cycles through ambiguous matches; paths with spaces
and Unicode are supported. `C-c m` opens a one-line minibuffer command with
Tab completion, Enter to run and `C-g` to cancel. Completion never executes
the command. Native Schememax and the local Browsered launcher continue to
run the full system shell.
