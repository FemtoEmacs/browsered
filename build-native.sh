#!/bin/sh
# Development only: rebuild the standalone page and native app.
set -eu
cd "$(dirname "$0")"
# femtoscheme in WebAssembly. Without Emscripten the prebuilt file is used.
if command -v emcc >/dev/null 2>&1; then
  femtoscheme/wasm/build.sh
else
  printf '%s\n' 'Emscripten not found (brew install emscripten): using the prebuilt femtoscheme.js.'
fi
sbcl --script build-standalone.lisp
mkdir -p Browsered.app/Contents/MacOS Browsered.app/Contents/Resources
clang -std=c11 -Wall -Wextra -Werror -O2 browsered.c assistant.c pdf.c -framework CoreFoundation -framework CoreGraphics -framework CoreText -lxml2 -lcmark-gfm -o Browsered.app/Contents/MacOS/browsered
cp Browsered.html keys.js browser-tests.html browser-tests.js assistant-schema.json formatting.xml \
   femtoscheme/wasm/femtoscheme.js scheme.js editor.scm init.scm Browsered.app/Contents/Resources/
printf '%s\n' 'Built Browsered.app. Double-click it to open the editor.'
