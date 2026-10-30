#!/bin/sh
# Take Schememax's C core and Scheme scripts into Browsered.
#
#   sh tools/sync-schememax.sh ../c2s-cover/sbcl-rasp/schememax
#   (or: make sync SCHEMEMAX=../c2s-cover/sbcl-rasp/schememax)
#
# Browsered is Schememax with a browser back end, so its src/, scheme/,
# femtoscheme/, ttfy/ and tests/ are Schememax's.  This copies them over,
# except Browsered's own files (src/web*.c, scheme/extensions/web.scm) and
# the three files that carry a few lines for the browser (src/native.c,
# src/primitives.c, femtoscheme/llt/dirpath.c): for those it says whether
# Schememax's copy changed, so the browser's lines can be carried over.
# Backups (bkp/) and built files are not copied.  Then run make and
# make check.
set -e
from=${1:?usage: sh tools/sync-schememax.sh path/to/schememax}
here=$(cd "$(dirname "$0")/.." && pwd)
test -f "$from/src/main.c" && test -d "$from/scheme" || {
	echo "$from does not look like Schememax (no src/main.c or scheme/)"; exit 1; }

copy_tree() {   # copy_tree DIR: Schememax's DIR over ours, minus bkp/ and built files
	( cd "$from" && find "$1" -type d -name bkp -prune -o -type f -print ) |
	while IFS= read -r f; do
		case "$f" in
		*.o|*.a|*.boot.tmp|femtoscheme/femtoscheme|src/native.c|src/primitives.c|femtoscheme/llt/dirpath.c) continue ;;
		esac
		if ! cmp -s "$from/$f" "$here/$f"; then
			mkdir -p "$here/$(dirname "$f")"
			cp "$from/$f" "$here/$f"
			echo "updated $f"
		fi
	done
}

for d in src scheme femtoscheme ttfy tests; do copy_tree "$d"; done

# tools/schememax-base/ holds Schememax's versions of the files Browsered
# changes, as they were when the browser's lines went in
for f in src/native.c src/primitives.c femtoscheme/llt/dirpath.c; do
	if ! cmp -s "$from/$f" "$here/tools/schememax-base/$f"; then
		echo "check by hand: $f changed in Schememax; carry the browser's lines"
		echo "  (diff tools/schememax-base/$f against $f) into Schememax's new version,"
		echo "  then copy Schememax's version to tools/schememax-base/$f"
	fi
done
echo "Done.  Now: make && make check"
