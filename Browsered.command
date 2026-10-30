#!/bin/sh
# Open Browsered with the signed-in Codex CLI. Double-click, or run ./Browsered.command.
set -e
cd "$(dirname "$0")"
mkdir -p build
if [ ! -x build/browsered-codex-bridge ] || [ tools/codex-bridge.c -nt build/browsered-codex-bridge ]; then
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -O2 tools/codex-bridge.c -o build/browsered-codex-bridge
fi
exec build/browsered-codex-bridge --page "$PWD/Browsered.html" "$@"
