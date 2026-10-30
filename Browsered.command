#!/bin/sh
# Open Browsered with the signed-in Codex CLI and Claude Code. Double-click, or run ./Browsered.command.
# C-x C-c in Browsered stops the launcher; then this Terminal window closes.
set -e
cd "$(dirname "$0")"
mkdir -p build
if [ ! -x build/browsered-codex-bridge ] || [ tools/codex-bridge.c -nt build/browsered-codex-bridge ]; then
    "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -O2 tools/codex-bridge.c -o build/browsered-codex-bridge
fi
set +e
build/browsered-codex-bridge --page "$PWD/Browsered.html" "$@"
status=$?
# Stopped by C-x C-c (or Ctrl-C): close this window of macOS's Terminal, the
# one whose terminal is ours, a moment after this script has ended
if [ "${TERM_PROGRAM:-}" = Apple_Terminal ] && tty=$(tty 2>/dev/null); then
    (sleep 1; osascript -e "tell application \"Terminal\" to close (every window whose tty of selected tab is \"$tty\")" \
         >/dev/null 2>&1) </dev/null >/dev/null 2>&1 &
fi
exit $status
