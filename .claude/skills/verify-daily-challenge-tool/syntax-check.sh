#!/usr/bin/env bash
# Syntax-check the inline JS in index.html using JavaScriptCore (no Node required).
# Prints "SYNTAX OK" or "SYNTAX ERROR: <message>".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HTML="$ROOT/index.html"
JS="$(mktemp /tmp/dct_inline.XXXXXX.js)"
CHK="$(mktemp /tmp/dct_check.XXXXXX.js)"
trap 'rm -f "$JS" "$CHK"' EXIT

# Extract every inline <script> body (skip those with a src= attribute).
python3 - "$HTML" "$JS" <<'PY'
import re, sys
html = open(sys.argv[1], encoding='utf-8').read()
inline = []
for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', html, re.S | re.I):
    if 'src=' in m.group(1).lower():
        continue
    inline.append(m.group(2))
open(sys.argv[2], 'w', encoding='utf-8').write('\n;\n'.join(inline))
PY

cat > "$CHK" <<EOF
ObjC.import('Foundation');
var code = ObjC.unwrap(\$.NSString.stringWithContentsOfFileEncodingError('$JS', \$.NSUTF8StringEncoding, null));
try { new Function(code); console.log('SYNTAX OK'); }
catch (e) { console.log('SYNTAX ERROR: ' + e.message); }
EOF

osascript -l JavaScript "$CHK"
