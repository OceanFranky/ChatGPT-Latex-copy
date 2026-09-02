// Runs in the page's MAIN world at document_start.
// It observes only same-page fetch/XHR response bodies and posts candidates locally.
(() => {
  'use strict';

  const EVENT_SOURCE = 'chatgpt-math-source-probe';
  const INSTALLED = '__chatgptMathSourceProbeInstalled__';
  const TEX_PATTERN = /\\(?:frac|d?frac|sqrt|sum|prod|int|iint|lim|left|right|begin|end|mathrm|mathbf|operatorname|text|Delta|alpha|beta|gamma|theta|leq|geq|neq|times|cdot|pm|overline|underline)\b/;
  const MAX_BODY_LENGTH = 2_000_000;

  if (window[INSTALLED]) return;
  window[INSTALLED] = true;

  function relevantUrl(input) {
    const raw = typeof input === 'string' ? input : input?.url ?? '';
    try {
      const url = new URL(raw, location.href);
      return url.hostname.endsWith('chatgpt.com') &&
        /conversation|backend-api|responses|completions|message|gen|chat/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function textFrom(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join('');
    if (!value || typeof value !== 'object') return '';
    if (Array.isArray(value.parts)) return textFrom(value.parts);
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    return '';
  }

  function inspectObject(root) {
    const candidates = [];
    const seen = new WeakSet();

    function visit(value, path, inheritedMessageId) {
      if (!value || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);

      const localId = typeof value.message_id === 'string' ? value.message_id
        : typeof value.messageId === 'string' ? value.messageId
        : value.message && typeof value.message.id === 'string' ? value.message.id
        : typeof value.id === 'string' && /message|mapping|conversation/i.test(path) ? value.id
        : inheritedMessageId;

      const directContent = textFrom(value.content) || textFrom(value.message?.content) ||
        (typeof value.output_text === 'string' ? value.output_text : '');
      const texCommands = directContent.match(/\\(?:frac|d?frac|sqrt|sum|prod|int|iint|lim|left|right|begin|end|mathrm|mathbf|operatorname|text|Delta|alpha|beta|gamma|theta|leq|geq|neq|times|cdot|pm|overline|underline)\b/g) ?? [];
      if (texCommands.length) {
        candidates.push({ messageId: localId ?? null, path, texCommands, content: directContent });
      }

      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') visit(child, `${path}.${key}`, localId);
      }
    }

    visit(root, '$', null);
    return candidates;
  }

  function parsePayload(body) {
    const payloads = [];
    try { payloads.push(JSON.parse(body)); } catch { /* possibly SSE */ }

    for (const line of body.split(/\r?\n/)) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      try { payloads.push(JSON.parse(data)); } catch { /* non-JSON stream chunk */ }
    }

    return payloads.flatMap(inspectObject);
  }

  function inspectBody(url, body, source) {
    if (!body || body.length > MAX_BODY_LENGTH || !TEX_PATTERN.test(body)) return;
    const candidates = parsePayload(body);
    if (!candidates.length) {
      candidates.push({
        messageId: null,
        path: '$unparsed',
        content: body.slice(0, 20_000),
      });
    }
    window.postMessage({ source: EVENT_SOURCE, type: 'candidate', url, transport: source, candidates }, location.origin);
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const response = await originalFetch.apply(this, arguments);
    if (relevantUrl(input)) {
      response.clone().text().then((body) => inspectBody(response.url, body, 'fetch'))
        .catch(() => undefined);
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__chatgptMathProbeUrl = String(url);
    return originalOpen.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function patchedSend() {
    this.addEventListener('loadend', () => {
      const url = this.__chatgptMathProbeUrl;
      if (relevantUrl(url) && typeof this.responseText === 'string') {
        inspectBody(url, this.responseText, 'xhr');
      }
    }, { once: true });
    return originalSend.apply(this, arguments);
  };

  console.info('[ChatGPT Math Probe] MAIN-world fetch/XHR observer installed.');
})();
