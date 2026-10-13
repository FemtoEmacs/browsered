#!/bin/sh
# Native PDF regression checks. No installed language runtime is required.
set -eu
cd "$(dirname "$0")/.."
test_binary=$(mktemp /tmp/browsered-pdf-test.XXXXXX)
trap 'rm -f "$test_binary"' EXIT HUP INT TERM
clang -std=c11 -Wall -Wextra -Werror pdf.c tests/pdf-tests.c \
  -framework CoreFoundation -framework CoreGraphics -framework CoreText \
  -lxml2 -lcmark-gfm -o "$test_binary"
"$test_binary" tests/markdown.md formatting.xml tests/changed-formatting.xml tests/invalid-formatting.xml
