# Architecture

```text
ChatGPT fetch / XHR / existing WebSocket response
  → history JSON or incremental SSE decoder (per response/topic)
  → source-probe-main.js (MAIN world)
  → window.postMessage
  → bridge.js (isolated world cache: messageId → raw content)
  → mouse Selection in an assistant message
  → selected KaTeX DOM order → raw LaTeX order
  → compact Markdown serialization → clipboard
```

## Why MAIN world is used

Regular content scripts run in an isolated world and cannot wrap the page's own network implementations. `source-probe-main.js` therefore runs at `document_start` in the page's MAIN world, observes relevant response bodies, and sends only matched candidates back to `bridge.js` through same-origin `window.postMessage`.

History responses contain complete messages. Live responses can contain incremental updates rather than complete text. SSE responses are read from a clone as they arrive, with UTF-8 and frame boundaries preserved. Existing ChatGPT WebSockets are observed passively; `encoded_item` SSE data is decoded separately for each topic. The observer does not create sockets, subscribe to topics, send requests, or read authentication headers.

The SSE/WS formats are private implementation details, not a supported OpenAI API. The `encoded_item` transport and delta pattern also appear in this [independent implementation](https://github.com/tianya518/gptclient-go/blob/main/sentinel/chat_ws.go). Local fixtures verify these formats; they are not a capture of the user's current browser session.

## Safety checks

Before replacing a selected rendered formula, `bridge.js` checks that:

1. the selection begins and ends in the same assistant message;
2. a matching raw message was captured for that message ID;
3. the number of raw formulas equals the number of rendered `.katex` formulas.

If any check fails, it keeps the clipboard unchanged and shows an error notification instead of guessing. A `copy blocked` console entry records the selected message ID, source/DOM formula counts, cache size, and transport status; it does not include message bodies or authentication data. The old text-prefix matching fallback was removed because similar openings are not proof of message identity.

## Scope

The implementation intentionally does not reverse KaTeX HTML into TeX. It uses raw message content when available, then normalizes all supported formula delimiters to `$$...$$` for compact Markdown output. Unknown live transport formats and source/DOM count differences still stop conversion.

Run local capture regressions with `node --test tests/*.test.cjs`. After reloading the extension, reload an already-open ChatGPT tab once to install the new observers; subsequent live replies should be captured through those observers without a page reload. This requires verification in the actual browser after an update.
