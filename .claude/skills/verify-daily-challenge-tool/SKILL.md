---
name: verify-daily-challenge-tool
description: Verify edits to the Daily Challenge Tool's index.html. Use after changing index.html to catch JS syntax errors and open the app for manual testing. This repo has no build step or test suite, and the sandboxed preview server cannot serve files, so verification is (1) a parse-only syntax check of the inline script (node --check, or JavaScriptCore on macOS) and (2) opening the self-contained file via file:// in the browser.
---

# Verify Daily Challenge Tool

`index.html` is a single self-contained file (~1.2MB, inline JS/CSS + base64 sprites). There is **no build step and no test suite**; Node may or may not be installed (it is on the Windows machine, not on the original Mac). The sandboxed preview server (`preview_start`) cannot read files in this repo, so the usual browser-driven preview tools fail here.

Use this two-step verification after editing `index.html`.

## Step 1 — Syntax check the inline JS (catches parse errors)

The script extracts every inline `<script>` body and parses it without executing (so DOM/`document` references don't matter). It uses `node --check` when Node is available and falls back to macOS JavaScriptCore (`osascript -l JavaScript`) otherwise:

```bash
bash .claude/skills/verify-daily-challenge-tool/syntax-check.sh
```

Expected output: `SYNTAX OK`. If it prints `SYNTAX ERROR: ...`, fix it before reporting done.

**Limitation:** this only catches *parse* errors, not behavior. It is a guardrail, not a substitute for actually using the feature.

## Step 2 — Open for manual testing

The file is self-contained, so `file://` works in a normal browser:

```bash
open "index.html"        # macOS
start index.html         # Windows
```

The Claude in-app browser refuses `file://`. For browser-tool verification start the static server defined in `.claude/launch.json` (`preview_start` with name `static` — it runs `python -m http.server 8765`) and open `http://localhost:8765/index.html`.

**Behavioral checks without an API key:** the AI Theme pipeline is `parseDeckDirectives(text)` → API request → `applyAIResult(result, numFriends, numPowers, cardsResolvedByJS, directives)`. Drive it from the console / `javascript_tool` with a hand-built `result` object to test enforcement (forced cards, random superpowers, per-deck counts) deterministically, then read `state.p0.cards` / `generateSQL()`.

Then exercise the change in the browser. Reload the tab after each edit. Key things to know:
- **Challenge tab** vs **Puzzle tab** are separate UIs/state — confirm you're testing the right one.
- Superpower dropdowns should list **12 loadouts** per pro (1 gold + 2 non-gold).
- `PlayerSettings` superpower fields show up in the generated SQL output panel live as you toggle the per-player "No superpowers" checkbox / draw-order picker.

State explicitly in your summary that the syntax check passed but the behavior was/was not manually verified — don't claim a feature works from the syntax check alone.
