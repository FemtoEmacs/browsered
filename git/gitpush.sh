#!/bin/sh
# Publish only when explicitly requested. Run from this checkout.
set -eu
cd "$(dirname "$0")/.."
if [ ! -d .git ]; then
  echo 'Clone https://github.com/FemtoEmacs/browsered first.' >&2
  exit 1
fi
if [ "$(git branch --show-current)" != main ]; then
  echo 'This publisher expects the main branch.' >&2
  exit 1
fi
if [ -s git/next-commit.txt ]; then sh git/gitcommit.sh; fi
git push origin main
