# Daily Challenge Tool

Single self-contained `index.html` (~6k lines) that generates SQL for Nova Island daily
challenges and puzzles. All JS, CSS, and card data are inline. No build, no framework, no Node.

## Card data

Never read card names or stats out of `index.html`, and never answer them from memory.
Use the `nova-island-cards` skill for every card lookup — including bare numeric IDs and
deck ID arrays, which only `card-data-reference.json` can resolve.

The card arrays inside `index.html` exist to render the UI. They are not the source of
truth for names, costs, classes, or balance history, and they go stale between patches.

## Verifying edits

Use the `verify-daily-challenge-tool` skill after changing `index.html`. There is no Node
and the preview server is sandboxed, so verification is a JavaScriptCore syntax check of
the inline script plus opening the file over `file://`.
