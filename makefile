# Browsered: Schememax in the browser.
#
# The editor is Schememax's C core and Scheme scripts, compiled to
# WebAssembly into one page, Browsered.html.  The page is in the
# repository, built: users open it in Chrome, Edge, Firefox or Safari, on
# any system, and build nothing.
#
#   make            Browsered.html (needs Emscripten: brew install emscripten)
#   make check      the femtoscheme suites and the editor's tests, natively
#                   (cc, make and curses: the same core, in a terminal)
#   make check-web  the page in a headless Chrome (needs node and playwright)
#   make sync       take Schememax's C core and scripts (see README)

CC ?= cc
.DEFAULT_GOAL := all
EMCC ?= emcc
CFLAGS ?= -O2 -Wall
CPPFLAGS += -Isrc -Ifemtoscheme -Ifemtoscheme/llt

# The C core: every source except the back ends and their programs.
#   web*.c    the browser back end (WebAssembly only)
#   term.c    the terminal back end (make check only)
#   gui.c, irene-dixe.c, app.c  Schememax's window and plot programs, and
#             its main(), compiled below for each target
CORE = $(filter-out src/term.c src/gui.c src/app.c src/irene-dixe.c src/web.c \
                    src/web-main.c src/web-scheme.c src/web-layer.c src/web-hot.c src/web-sdl.c src/web-irene-main.c, \
                    $(wildcard src/*.c))
WEB = src/web.c src/web-main.c src/web-scheme.c src/web-layer.c src/web-hot.c
FEMTO = $(addprefix femtoscheme/, flisp.c builtins.c string.c equalhash.c table.c iostream.c)
LLT = $(addprefix femtoscheme/llt/, bitvector.c hashing.c socket.c timefuncs.c ptrhash.c \
        utf8.c ios.c dirpath.c htable.c bitvector-ops.c int2str.c dump.c random.c lltinit.c)
SCRIPTS = $(wildcard scheme/*.scm scheme/*/*.scm)

UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
CURSES_LIBS ?= -lncurses
PDF_LIBS = -framework CoreGraphics -framework ImageIO -framework CoreFoundation
else
CURSES_LIBS ?= -lncursesw
endif

# Emscripten renamed TOTAL_STACK to STACK_SIZE in 3.1.27
EMVERSION := $(shell $(EMCC) -dumpversion 2>/dev/null)
STACK := $(if $(filter 1.% 2.% 3.0.% 3.1.0 3.1.1 3.1.2 3.1.3 3.1.4 3.1.5 3.1.6 3.1.7 3.1.8 3.1.9 3.1.1% 3.1.20 3.1.21 3.1.22 3.1.23 3.1.24 3.1.25 3.1.26,$(EMVERSION)),TOTAL_STACK,STACK_SIZE)

# Asyncify lets the C loop wait for a key while the page runs; its stack
# must hold femtoscheme's, which can be deep.
EMCFLAGS = -O2 -Wno-everything -DSBEMACS_GUI -DNDEBUG $(CPPFLAGS)
EMFLAGS = $(EMCFLAGS) \
	-lidbfs.js -s ASYNCIFY=1 -s ASYNCIFY_STACK_SIZE=4194304 \
	-s ALLOW_MEMORY_GROWTH=1 -s $(STACK)=4194304 -s SINGLE_FILE=1 \
	-s ENVIRONMENT=web -s EXIT_RUNTIME=0 \
	-s EXPORTED_FUNCTIONS=_main,_malloc,_free,_web_set_scrap \
	-s EXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,lengthBytesUTF8

.PHONY: all check check-web check-codex-bridge codex-bridge run sync clean

codex-bridge: build/browsered-codex-bridge

build/browsered-codex-bridge: tools/codex-bridge.c
	mkdir -p build
	$(CC) -std=c11 -Wall -Wextra -Werror -O2 $< -o $@

run: codex-bridge
	./Browsered.command

check-codex-bridge: codex-bridge
	node tests/codex-bridge-test.js

ifeq ($(shell command -v $(EMCC) 2>/dev/null),)
all:
	@echo "Browsered.html is built already: open it in a browser."
	@echo "To rebuild it after changing the C core or the scripts, install Emscripten"
	@echo "(macOS: brew install emscripten) and run make again."
else
all: Browsered.html
endif

# app.c's main becomes app_main; web-main.c's main() passes it the page's arguments
build/app.o: src/app.c src/header.h
	mkdir -p build
	$(EMCC) $(EMCFLAGS) -Dmain=app_main -c src/app.c -o $@

build/core.js: build/app.o $(CORE) $(WEB) $(FEMTO) $(LLT) src/header.h src/screen.h \
               web/browsered.js femtoscheme/femtoscheme.boot $(SCRIPTS)
	$(EMCC) $(EMFLAGS) -Wl,--wrap=getfilename -Wl,--wrap=getfilename_default -Wl,--wrap=line_edit $(CORE) $(WEB) build/app.o $(FEMTO) $(LLT) -o $@ \
	    --pre-js web/browsered.js \
	    --embed-file femtoscheme/femtoscheme.boot@/femtoscheme/femtoscheme.boot \
	    --embed-file scheme@/scheme --exclude-file '*/bkp/*' \
	    --embed-file ttfy/plots-guidelines.md@/ttfy/plots-guidelines.md

# irene-dixe (C-c p), a module of its own: Schememax's irene-dixe.c with
# the SDL calls drawn on canvases (src/web-sdl.c, web/sdl/)
build/irene-dixe.js: src/irene-dixe.c src/web-sdl.c src/web-irene-main.c web/sdl/SDL.h \
                     web/sdl/SDL_ttf.h web/irene-dixe-pre.js
	mkdir -p build
	$(EMCC) -O2 -Wno-everything -Iweb/sdl -Dmain=irene_main -c src/irene-dixe.c -o build/irene-dixe.o
	$(EMCC) -O2 -Wno-everything -Iweb/sdl build/irene-dixe.o src/web-sdl.c src/web-irene-main.c \
	    -o $@ --pre-js web/irene-dixe-pre.js -s MODULARIZE=1 -s EXPORT_NAME=createIreneDixe \
	    -s ASYNCIFY=1 -s SINGLE_FILE=1 -s ENVIRONMENT=web -s EXIT_RUNTIME=1 \
	    -s ALLOW_MEMORY_GROWTH=1 -s FORCE_FILESYSTEM=1 -s EXPORTED_FUNCTIONS=_main,_malloc \
	    -s EXPORTED_RUNTIME_METHODS=FS,UTF8ToString,stringToUTF8,lengthBytesUTF8

# Schemer uses a separate compiler VM so its expander cannot shadow editor macros.
# one page: web/shell.html with the program in place of {{{ SCRIPT }}}
Browsered.html: build/core.js build/irene-dixe.js schemer/compiler.wasm $(wildcard schemer/*) web/schemer.js web/shell.html web/vendor/pdf.min.js web/vendor/pdf.worker.min.js
	sed -n '1,/{{{ SCRIPT }}}/p' web/shell.html | sed '$$d' > $@.new
	printf '<script>\n' >> $@.new
	cat build/core.js >> $@.new
	printf '\n</script>\n<script>\n' >> $@.new
	cat build/irene-dixe.js >> $@.new
	printf '\n</script>\n<script>\n' >> $@.new
	cat schemer/host.js web/schemer.js >> $@.new
	printf '\n</script>\n<script type="text/plain" id="schemer-compiler-wasm">\n' >> $@.new
	base64 < schemer/compiler.wasm | tr -d '\n' >> $@.new
	printf '\n</script>\n<script>\n' >> $@.new
	printf '\n</script>\n<script>\n' >> $@.new
	cat web/vendor/pdf.min.js >> $@.new
	printf '\n</script>\n<script type="text/plain" id="pdf-worker">\n' >> $@.new
	cat web/vendor/pdf.worker.min.js >> $@.new
	printf '\n</script>\n' >> $@.new
	sed -n '/{{{ SCRIPT }}}/,$$p' web/shell.html | sed '1d' >> $@.new
	mv $@.new $@
	@echo "Built Browsered.html: open it in a browser."

# The same core in a terminal, for the tests (Schememax's make check);
# beside scheme/ and femtoscheme/, where it finds them
femtoscheme/libfemtoscheme.a:
	$(MAKE) -C femtoscheme release CC="$(CC)"

build/term/%.o: src/%.c src/header.h src/public.h
	mkdir -p build/term
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

browsered-term: $(patsubst src/%.c,build/term/%.o,$(CORE) src/term.c src/app.c) femtoscheme/libfemtoscheme.a
	$(CC) $(LDFLAGS) $(filter %.o,$^) femtoscheme/libfemtoscheme.a femtoscheme/llt/libllt.a \
	    $(CURSES_LIBS) $(PDF_LIBS) -lm -o $@

check: browsered-term
	$(MAKE) -C femtoscheme test
	./browsered-term --eval '(+ 20 22)' | grep -x 42
	SCHEMEMAX_NO_INIT=1 ./browsered-term --eval '(load "tests/run-tests.scm")'
	./browsered-term --eval "(bound? 'open-folder)" | grep -x '#t'
	! ./browsered-term --eval '(error "expected test error")'

check-web: Browsered.html codex-bridge
	node tests/web-test.js
	node tests/startup-errors-test.js
	node tests/document-editor-test.js
	node tests/writing-keys-test.js
	node tests/writing-search-test.js
	node tests/text-layer-test.js
	node tests/hot-test.js
	node tests/windows-resize-test.js
	node tests/user-init-test.js
	node tests/entrypoint-test.js
	node tests/shell-folder-test.js
	node tests/shell-tab-test.js
	node tests/safari-files-test.js
	node tests/save-as-test.js
	node tests/comment-test.js
	node tests/search-input-test.js
	node tests/buffer-menu-test.js
	node tests/file-info-test.js
	node tests/claude-bridge-page-test.js
	node tests/schemer-test.js
	node tests/assistant-commands-test.js
	node tests/assistant-windows-test.js

# Take Schememax's core and scripts, from GitHub (FemtoEmacs/sbcl-rasp)
# into build/sbcl-rasp, never from the user's own folders; SCHEMEMAX=path
# takes them from another copy.  Browsered's own files (web*.c,
# scheme/extensions/web.scm) are kept; src/native.c, src/primitives.c and
# femtoscheme/llt/dirpath.c carry a few lines for the browser, so they are
# reported, not overwritten.
SCHEMEMAX_REPO ?= https://github.com/FemtoEmacs/sbcl-rasp.git
sync:
	@if [ -z "$(SCHEMEMAX)" ]; then \
	    if [ -d build/sbcl-rasp/.git ]; then git -C build/sbcl-rasp pull --ff-only; \
	    else mkdir -p build && git clone --depth 1 $(SCHEMEMAX_REPO) build/sbcl-rasp; fi; \
	    sh tools/sync-schememax.sh build/sbcl-rasp/schememax; \
	else sh tools/sync-schememax.sh "$(SCHEMEMAX)"; fi

clean:
	rm -rf build browsered-term
	$(MAKE) -C femtoscheme clean
