// Runs in the page's MAIN world at document_start.
// Passively observes the page's existing fetch/XHR/WebSocket responses.
(() => {
  'use strict';

  const EVENT_SOURCE = 'chatgpt-math-source-probe';
  const INSTALLED = '__chatgptMathSourceProbeInstalled__';
  const TEX_COMMAND_PATTERN = /\\(?:frac|d?frac|sqrt|sum|prod|int|iint|lim|left|right|begin|end|mathrm|mathbf|operatorname|text|Delta|alpha|beta|gamma|theta|leq|geq|neq|times|cdot|pm|overline|underline)\b/g;
  // Do not require a backslash command: $100元$ is still a real math source.
  const MATH_SOURCE_PATTERN = /\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|(?<!\$)\$(?!\$)(?:\\.|[^$\\])+\$(?!\$)/;
  const MAX_BODY_LENGTH = 2_000_000;

  if (window[INSTALLED]) return;
  window[INSTALLED] = true;

  function relevantUrl(input) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? '';
    try {
      const url = new URL(raw, location.href);
      return (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')) &&
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

    function visit(value, path, inheritedMessageId, inheritedRole) {
      if (!value || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);

      const role = value.message?.author?.role ?? value.author?.role ?? inheritedRole;
      if (role && role !== 'assistant') return;

      const localId = typeof value.message_id === 'string' ? value.message_id
        : typeof value.messageId === 'string' ? value.messageId
        : value.message && typeof value.message.id === 'string' ? value.message.id
        : typeof value.id === 'string' && (value.content || /message|mapping|conversation/i.test(path)) ? value.id
        : inheritedMessageId;

      const directContent = textFrom(value.content) || textFrom(value.message?.content) ||
        (typeof value.output_text === 'string' ? value.output_text : '');
      const texCommands = directContent.match(TEX_COMMAND_PATTERN) ?? [];
      if (directContent.length <= MAX_BODY_LENGTH && (texCommands.length || MATH_SOURCE_PATTERN.test(directContent))) {
        candidates.push({ messageId: localId ?? null, path, texCommands, content: directContent });
      }

      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') visit(child, `${path}.${key}`, localId, role);
      }
    }

    visit(root, '$', null);
    return candidates;
  }

  function report(transport, reason) {
    // No response bodies, auth headers, or socket URL query strings in diagnostics.
    window.postMessage({ source: EVENT_SOURCE, type: 'capture-status', transport, reason }, location.origin);
  }

  function publish(root, transport, assembled = false) {
    const candidates = inspectObject(root).filter((candidate) => candidate.messageId)
      .map((candidate) => ({ ...candidate, transport, assembled }));
    if (candidates.length) {
      window.postMessage({ source: EVENT_SOURCE, type: 'candidate', transport, candidates }, location.origin);
      report(transport, 'candidate-emitted');
    }
  }

  function createMessageDecoder(transport) {
    let root = {};
    let lastPath = '';
    let lastOperation = '';

    function applyDelta(event, base = '') {
      if (!event || typeof event !== 'object') return;
      if (event.o === 'patch' && Array.isArray(event.v)) {
        const prefix = base + (event.p ?? '');
        for (const child of event.v) applyDelta(child, prefix);
        return;
      }
      const path = typeof event.p === 'string' ? base + event.p : lastPath;
      const operation = event.o ?? lastOperation;
      if (!['add', 'replace', 'append', 'remove'].includes(operation)) return;
      if (!path && ['add', 'replace'].includes(operation)) {
        if (event.v && typeof event.v === 'object') {
          root = structuredClone(event.v);
          lastPath = '';
          lastOperation = '';
        }
        return;
      }
      // Only reconstruct the message tree. Metadata elsewhere is irrelevant.
      const keys = path.split('/').slice(1).map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'));
      if (keys[0] !== 'message' || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) return;
      let parent = root;
      for (const key of keys.slice(0, -1)) {
        if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) return;
        parent = parent[key];
      }
      if (!parent || typeof parent !== 'object') return;
      const key = keys.at(-1);
      if (operation === 'append') {
        if (typeof parent[key] === 'string' && typeof event.v === 'string') parent[key] += event.v;
        else if (Array.isArray(parent[key]) && Array.isArray(event.v)) parent[key].push(...event.v);
        else return;
      } else if (operation === 'remove') {
        if (Array.isArray(parent)) parent.splice(Number(key), 1);
        else delete parent[key];
      } else {
        parent[key] = structuredClone(event.v);
      }
      lastPath = path;
      lastOperation = operation;
    }

    return (event) => {
      if (!event || typeof event !== 'object') return;
      if (event.type === 'stream_handoff') {
        report(transport, 'stream-handoff');
        return;
      }
      if (event.message) {
        root = structuredClone(event);
        lastPath = '';
        lastOperation = '';
        publish(root, transport, true);
      } else if (Object.hasOwn(event, 'v') || event.o === 'remove') {
        applyDelta(event);
        publish(root, transport, true);
      } else {
        publish(event, transport);
      }
    };
  }

  function createSSEReader(transport) {
    const accept = createMessageDecoder(transport);
    let pending = '';
    function dispatch(block) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data || data === '[DONE]') return;
      try { accept(JSON.parse(data)); } catch { report(transport, 'unrecognized-event'); }
    }
    return {
      accept,
      push(text) {
        pending += text;
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(pending))) {
          dispatch(pending.slice(0, boundary.index));
          pending = pending.slice(boundary.index + boundary[0].length);
        }
        if (pending.length > MAX_BODY_LENGTH) {
          pending = '';
          report(transport, 'event-too-large');
        }
      },
      end() { if (pending.trim()) dispatch(pending); pending = ''; },
    };
  }

  function inspectBody(body, transport) {
    if (!body || body.length > MAX_BODY_LENGTH) return;
    // Parse JSON before looking for TeX: a serialized body has escaped slashes.
    try { publish(JSON.parse(body), transport); return; } catch { /* SSE */ }
    const parser = createSSEReader(transport);
    parser.push(body);
    parser.end();
  }

  async function inspectResponse(response) {
    const clone = response.clone();
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !clone.body) {
      inspectBody(await clone.text(), 'fetch');
      return;
    }
    const parser = createSSEReader('sse');
    const decoder = new TextDecoder();
    const reader = clone.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.end();
    } finally { reader.releaseLock(); }
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const response = await originalFetch.apply(this, arguments);
    if (relevantUrl(input) || relevantUrl(response.url)) {
      report('fetch', 'response-observed');
      inspectResponse(response).catch(() => report('fetch', 'read-failed'));
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
      if (!relevantUrl(url)) return;
      report('xhr', 'response-observed');
      if (this.responseType === 'json') publish(this.response, 'xhr');
      else if (!this.responseType || this.responseType === 'text') inspectBody(this.responseText, 'xhr');
    }, { once: true });
    return originalSend.apply(this, arguments);
  };

  if (window.WebSocket) {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        const hostname = new URL(socket.url).hostname;
        if (hostname !== 'chatgpt.com' && !hostname.endsWith('.chatgpt.com')) return socket;
        const topics = new Map();
        function visit(value, topic = 'socket') {
          if (!value || typeof value !== 'object') return;
          topic = typeof value.topic_id === 'string' ? value.topic_id : topic;
          if (typeof value.encoded_item === 'string' || value.message) {
            if (!topics.has(topic)) topics.set(topic, createSSEReader('websocket'));
            const parser = topics.get(topic);
            if (typeof value.encoded_item === 'string') {
              report('websocket', 'encoded-item-observed');
              parser.push(value.encoded_item);
              // The envelope supplies the event boundary. Unlike fetch chunks,
              // encoded_item need not end in an SSE blank line. Flush this item
              // now, retaining the same message decoder for following deltas.
              parser.end();
            } else parser.accept(value);
            return;
          }
          for (const child of Object.values(value)) visit(child, topic);
        }
        // Keep binary/text frame processing in arrival order. Observe only;
        // never open sockets, send, subscribe, or change the page's handlers.
        let queue = Promise.resolve();
        socket.addEventListener('message', (event) => {
          queue = queue.then(async () => {
            const raw = typeof event.data === 'string' ? event.data
              : event.data instanceof Blob ? await event.data.text()
              : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : '';
            if (!raw || raw.length > MAX_BODY_LENGTH) return;
            report('websocket', 'frame-observed');
            try { visit(JSON.parse(raw)); } catch { report('websocket', 'unrecognized-frame'); }
          }).catch(() => report('websocket', 'read-failed'));
        });
        socket.addEventListener('close', () => { queue = queue.then(() => topics.clear()); });
        return socket;
      },
    });
  }

  console.info('[ChatGPT Math Probe] MAIN-world fetch/XHR/SSE/WebSocket observers installed.');
})();
