---
name: verify-daily-challenge-tool
description: Verify edits to the Daily Challenge Tool's index.html. Use after changing index.html to catch JS syntax errors and open the app for manual testing. This repo has no build and no Node, and the sandboxed preview server cannot serve files, so verification is (1) a JavaScriptCore syntax check of the inline script and (2) opening the self-contained file via file:// in the browser.
---

# Verify Daily Challenge Tool

`index.html` is a single self-contained file (~1.2MB, inline JS/CSS + base64 sprites). There is **no build step, no Node, and no test suite**. The sandboxed preview server (`preview_start`) cannot read files in this repo, so the usual browser-driven preview tools fail here.

Use this two-step verification after editing `index.html`.

## Step 1 — Syntax check the inline JS (catches parse errors)

There is no Node, but macOS ships JavaScriptCore via `osascript -l JavaScript`. Extract the inline `<script>` body and compile it with `new Function(code)`, which parses without executing (so DOM/`document` references at runtime don't matter):

```bash
bash .claude/skills/verify-daily-challenge-tool/syntax-check.sh
```

Expected output: `SYNTAX OK`. If it prints `SYNTAX ERROR: ...`, fix it before reporting done.

**Limitation:** this only catches *parse* errors, not behavior. It is a guardrail, not a substitute for actually using the feature.

## Step 2 — Open for manual testing

The file is self-contained, so `file://` works (no server needed):

```bash
open "index.html"
```

Then exercise the change in the browser. Reload the tab after each edit. Key things to know:
- **Challenge tab** vs **Puzzle tab** are separate UIs/state — confirm you're testing the right one.
- Superpower dropdowns should list **12 loadouts** per pro (1 gold + 2 non-gold).
- `PlayerSettings` superpower fields show up in the generated SQL output panel live as you toggle the per-player "No superpowers" checkbox / draw-order picker.

State explicitly in your summary that the syntax check passed but the behavior was/was not manually verified — don't claim a feature works from the syntax check alone.
