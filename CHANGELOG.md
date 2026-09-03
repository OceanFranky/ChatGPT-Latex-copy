# Changelog

## 1.4.1 - 2026-09-03

- Flush each complete WebSocket `encoded_item` even when it omits SSE blank-line terminators; retain the topic's decoder state between items.
- Add a regression that keeps the socket open and sends delimiter-free items. This failed under 1.4.0.
- Include observation, encoded-item, and candidate-emission counters in copy-failure diagnostics.

## 1.4.0 - 2026-09-03

- Reconstruct incremental SSE messages while the connection is open.
- Observe existing ChatGPT WebSocket message frames and decode `encoded_item` SSE by topic, without opening connections or sending requests.
- Keep stream corrections even when the corrected reply is shorter.
- Remove the unverified text-prefix fallback; match the selected message by ID.
- Distinguish missing source from formula-count mismatches in the toast and `copy blocked` diagnostic.
- Add regression tests for history, live SSE, interleaved WebSocket topics, and corrections.

## 1.0.0–1.3.0 - 2026-09-03

- Preserve literal double-dollar delimiters through replacement callbacks.
- Show the loaded extension version on the copy button.
- Expand simple-math detection and adjust cache handling.

## 0.7.0 - 2026-09-03

- Normalize every copied formula to block-level `$$...$$` for Yuque compatibility.

## 0.6.0 - 2026-09-03

- Remove duplicate KaTeX visual text that can appear next to converted formula source in a partial selection.

## 0.5.0 - 2026-09-02

- Add Stone & Ink styling for the floating copy control and notifications.
- Normalize copied display math to compact `$$...$$` Markdown.
- Move notifications above the copy control and remove its hover tooltip.

## 0.4.0 - 2026-09-02

- Add Gemini-style compact LaTeX formatting.

## 0.3.0 - 2026-09-02

- Add partial-selection copying inside one assistant reply.

## 0.1.0 - 2026-09-02

- Initial local Network-source feasibility probe.
