#!/bin/sh
# Assemble the hosted editor (GitHub Pages) in the given directory.
# Browsered.html must be current: sbcl --script build-standalone.lisp
set -eu
cd "$(dirname "$0")/.."
SITE=${1:-site}
rm -rf "$SITE"
mkdir -p "$SITE/icons"
cp Browsered.html "$SITE/index.html"
cp web/manifest.webmanifest web/sw.js init.scm "$SITE/"
cp web/icons/*.png "$SITE/icons/"
printf 'Assembled %s\n' "$SITE"
