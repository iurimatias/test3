#!/usr/bin/env bash
# Publish to GitHub Pages.
#
# GitHub Pages serves assets with `Cache-Control: max-age=600`, so a plain push
# leaves visitors running up to ten minutes of stale JavaScript. This stamps
# every local script and stylesheet with a fresh ?v= before committing, which
# makes each deploy a new URL and takes effect the moment the page reloads.
#
# Usage:  ./deploy.sh "commit message"
set -euo pipefail

cd "$(dirname "$0")"

BRANCH=gh-pages
MSG=${1:-"Update"}
STAMP=$(date +%Y%m%d%H%M%S)

if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  echo "error: on $(git rev-parse --abbrev-ref HEAD), expected $BRANCH" >&2
  exit 1
fi

# rewrite ?v=... on local js/css references in index.html
python3 - "$STAMP" <<'PY'
import re, sys, pathlib
stamp = sys.argv[1]
p = pathlib.Path('index.html')
s = p.read_text()
s = re.sub(r'(<script src="js/[a-z]+\.js)(\?v=[^"]*)?"', rf'\1?v={stamp}"', s)
s = re.sub(r'(<link rel="stylesheet" href="css/style\.css)(\?v=[^"]*)?"', rf'\1?v={stamp}"', s)
p.write_text(s)
print(f'stamped {len(re.findall(re.escape(stamp), s))} refs with v={stamp}')
PY

git add -A
if git diff --cached --quiet; then
  echo "nothing to commit"
else
  git commit -q -m "$MSG"
fi
git push origin "$BRANCH"

echo "waiting for the Pages build..."
for _ in $(seq 1 24); do
  status=$(gh api repos/iurimatias/test3/pages/builds/latest --jq .status 2>/dev/null || echo "?")
  [ "$status" = "built" ] && { echo "built"; break; }
  sleep 5
done
echo "live: https://iurimatias.github.io/test3/"
