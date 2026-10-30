#!/bin/sh
# Stage only public web assets, never the helper, credentials or source tree.
set -eu
cd "$(dirname "$0")/.."
site_dir=${1:-site}
mkdir -p "$site_dir"
cp Browsered.html "$site_dir/index.html"
cp Browsered.html "$site_dir/Browsered.html"
: > "$site_dir/.nojekyll"
printf 'Browsered site assembled in %s\n' "$site_dir"
