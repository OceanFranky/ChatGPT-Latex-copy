# Architecture

```text
ChatGPT fetch / XHR response
  → source-probe-main.js (MAIN world)
  → window.postMessage
  → bridge.js (isolated world cache: messageId → raw content)
  → mouse Selection in an assistant message
  → selected KaTeX DOM order → raw LaTeX order
  → compact Markdown serialization → clipboard
```

## Why MAIN world is used

Regular content scripts run in an isolated world and cannot wrap the page's own `fetch` or XHR implementations. `source-probe-main.js` therefore runs at `document_start` in the page's MAIN world, observes relevant response bodies, and sends only matched candidates back to `bridge.js` through same-origin `window.postMessage`.

## Safety checks

Before replacing a selected rendered formula, `bridge.js` checks that:

1. the selection begins and ends in the same assistant message;
2. a matching raw message was captured for that message ID;
3. the number of raw formulas equals the number of rendered `.katex` formulas.

If any check fails, it keeps the clipboard unchanged and shows an error notification instead of guessing.

## Scope

The implementation intentionally does not reverse KaTeX HTML into TeX. It uses raw message content when available, then normalizes `\\[...\\]` to `$$...$$` and `\\(...\\)` to `$...$` for compact Markdown output.
