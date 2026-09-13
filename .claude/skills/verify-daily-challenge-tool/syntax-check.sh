#!/usr/bin/env bash
# Syntax-check the inline JS in index.html without executing it.
# Prints "SYNTAX OK" or "SYNTAX ERROR: <message>".
#
# Engine preference: node (any platform) -> JavaScriptCore via osascript (macOS).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HTML="$ROOT/index.html"
TMPDIR_="${TMPDIR:-/tmp}"
JS="$(mktemp "$TMPDIR_/dct_inline.XXXXXX")"; JS="$JS.js"
CHK="$(mktemp "$TMPDIR_/dct_check.XXXXXX")"; CHK="$CHK.js"
trap 'rm -f "$JS" "$CHK"' EXIT

# Pick a python that actually runs (on Windows, `python3` may be a Store alias stub).
PY=""
for c in python3 python py; do
  if "$c" -c 'pass' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "SYNTAX ERROR: python not found (needed to extract <script> bodies)"; exit 1; }

# Extract every inline <script> body (skip those with a src= attribute).
"$PY" - "$HTML" "$JS" <<'PYCODE'
import re, sys
html = open(sys.argv[1], encoding='utf-8').read()
inline = []
for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', html, re.S | re.I):
    if 'src=' in m.group(1).lower():
        continue
    inline.append(m.group(2))
open(sys.argv[2], 'w', encoding='utf-8').write('\n;\n'.join(inline))
PYCODE

if command -v node >/dev/null 2>&1; then
  # `node --check` parses without running, so DOM references are fine.
  if out="$(node --check "$JS" 2>&1)"; then
    echo "SYNTAX OK"
  else
    echo "SYNTAX ERROR: $(printf '%s' "$out" | grep -m1 -E 'SyntaxError|Error' || printf '%s' "$out" | head -1)"
    printf '%s\n' "$out" | head -8
    exit 1
  fi
elif command -v osascript >/dev/null 2>&1; then
  cat > "$CHK" <<EOF
ObjC.import('Foundation');
var code = ObjC.unwrap(\$.NSString.stringWithContentsOfFileEncodingError('$JS', \$.NSUTF8StringEncoding, null));
try { new Function(code); console.log('SYNTAX OK'); }
catch (e) { console.log('SYNTAX ERROR: ' + e.message); }
EOF
  osascript -l JavaScript "$CHK"
else
  echo "SYNTAX ERROR: no JS engine found (install node, or run on macOS for osascript)"
  exit 1
fi
