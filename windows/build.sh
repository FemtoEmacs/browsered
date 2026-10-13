#!/bin/sh
# Build browsered.exe with mingw-w64 and stage everything the installer
# packs in windows/stage. Browsered.html must be current
# (sbcl --script build-standalone.lisp). Then: iscc windows/browsered.iss
set -eu
cd "$(dirname "$0")"
VERSION=${BROWSERED_VERSION:-0.1.0}
# 1.2.3 -> 1,2,3,0 for the version resource
NUMBER=$(printf '%s' "$VERSION" | sed 's/[^0-9.].*//' | awk -F. '{printf "%d,%d,%d,0", $1, $2, $3}')
CC=${MINGW_CC:-x86_64-w64-mingw32-gcc}
WINDRES=${MINGW_WINDRES:-x86_64-w64-mingw32-windres}

rm -rf stage build
mkdir -p stage build
"$WINDRES" -DVERSION_NUMBER="$NUMBER" -DVERSION_STRING="\\\"$VERSION\\\"" \
  browsered.rc -O coff -o build/resource.o
"$CC" -std=c11 -O2 -s -Wall -Wextra -Werror -municode -mwindows \
  -o stage/browsered.exe browsered-win.c build/resource.o -lws2_32 -lshell32
cd ..
cp Browsered.html keys.js browser-tests.html browser-tests.js scheme.js editor.scm \
   init.scm assistant-schema.json femtoscheme/wasm/femtoscheme.js windows/stage/
cp femtoscheme/LICENSE windows/stage/femtoscheme-LICENSE.txt
printf 'Staged Browsered %s for Windows in windows/stage\n' "$VERSION"
