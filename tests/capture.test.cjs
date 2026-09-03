const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../source-probe-main.js'), 'utf8');
const origin = 'https://chatgpt.com';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sse = (value) => `data: ${JSON.stringify(value)}\n\n`;
const snapshot = (id, text = '') => ({ message: {
  id, author: { role: 'assistant' }, content: { parts: [text] },
} });

function harness(response) {
  const posts = [];
  class FakeXHR { open() {} send() {} }
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    constructor(url) { super(); this.url = url; }
    receive(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
  }
  const window = {
    fetch: async () => response,
    WebSocket: FakeSocket,
    postMessage: (message) => posts.push(message),
  };
  vm.runInNewContext(source, {
    window, XMLHttpRequest: FakeXHR, URL, TextDecoder, Blob, ArrayBuffer,
    structuredClone, location: { origin, href: `${origin}/c/test` },
    console: { info() {}, warn() {} },
  });
  return { window, posts, FakeSocket,
    candidates: () => posts.flatMap((post) => post.candidates ?? []),
  };
}

test('history response captures simple-dollar formulas under their message ID', async () => {
  const text = '昨日 $100元$，今天 $102元$。';
  const h = harness(new Response(JSON.stringify({ messages: [snapshot('history', text).message] })));
  const result = await h.window.fetch(`${origin}/backend-api/conversation/test`);
  assert.ok((await result.text()).includes('history'));
  for (let i = 0; i < 10 && !h.candidates().length; i++) await tick();
  assert.ok(h.candidates().some((c) => c.messageId === 'history' && c.content === text));
});

test('SSE assembles split TeX before the connection closes, without consuming the page response', async () => {
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const h = harness(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  const pageResponse = await h.window.fetch(new URL(`${origin}/backend-api/f/conversation`));
  const chunks = [
    sse({ o: 'add', v: snapshot('live') }),
    sse({ p: '/message/content/parts/0', o: 'append', v: '结果是 \\[\\fr' }),
    sse({ v: 'ac{1}{2}\\]' }),
  ];
  // Break the encoded response inside JSON and multi-byte Chinese characters.
  const bytes = new TextEncoder().encode(chunks.join(''));
  for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
  for (let i = 0; i < 30 && !h.candidates().some((c) => c.messageId === 'live'); i++) await tick();
  const capturedBeforeClose = h.candidates().findLast((c) => c.messageId === 'live');
  controller.close();
  assert.equal(await pageResponse.text(), chunks.join(''));
  assert.equal(capturedBeforeClose?.content, '结果是 \\[\\frac{1}{2}\\]');
});

test('WebSocket encoded_item deltas remain separated by topic', async () => {
  const h = harness();
  const socket = new h.window.WebSocket('wss://ws.chatgpt.com/p4/ws/user/test');
  assert.ok(socket instanceof h.FakeSocket);
  assert.equal(h.window.WebSocket.OPEN, 1);
  const send = (topic, value) => socket.receive(JSON.stringify([{
    payload: { topic_id: topic, payload: { encoded_item: sse(value) } },
  }]));
  send('turn-a', { o: 'add', v: snapshot('a') });
  send('turn-b', { o: 'add', v: snapshot('b') });
  send('turn-a', { p: '/message/content/parts/0', o: 'append', v: '$100' });
  send('turn-b', { p: '/message/content/parts/0', o: 'append', v: '$200元$' });
  send('turn-a', { v: '元$' });
  for (let i = 0; i < 30 && h.candidates().length < 2; i++) await tick();
  assert.equal(h.candidates().findLast((c) => c.messageId === 'a')?.content, '$100元$');
  assert.equal(h.candidates().findLast((c) => c.messageId === 'b')?.content, '$200元$');
});

test('complete WebSocket encoded items do not require SSE blank-line terminators', async () => {
  const h = harness();
  const socket = new h.window.WebSocket('wss://ws.chatgpt.com/p4/ws/user/test');
  const send = (value) => socket.receive(JSON.stringify({
    payload: { topic_id: 'turn-without-newlines', payload: {
      encoded_item: `event: delta\ndata: ${JSON.stringify(value)}`,
    } },
  }));
  send({ o: 'add', v: snapshot('no-terminator') });
  send({ p: '/message/content/parts/0', o: 'append', v: '结果 \\[\\fr' });
  send({ v: 'ac{1}{2}\\]' });
  // Leave the socket open, as the browser does between ChatGPT replies.
  for (let i = 0; i < 30 && !h.candidates().length; i++) await tick();
  assert.equal(h.candidates().findLast((c) => c.messageId === 'no-terminator')?.content,
    '结果 \\[\\frac{1}{2}\\]');
});

test('patch replacement emits the corrected shorter content, and ignores user messages', async () => {
  const events = [
    { o: 'add', v: snapshot('corrected', '$100元$ 和 $200元$') },
    { o: 'patch', v: [{ p: '/message/content/parts/0', o: 'replace', v: '$99元$' }] },
    { message: { id: 'user', author: { role: 'user' }, content: { parts: ['$10$'] } } },
  ];
  const h = harness(new Response(events.map(sse).join(''), { headers: { 'content-type': 'text/event-stream' } }));
  await h.window.fetch(`${origin}/backend-api/f/conversation`);
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(h.candidates().findLast((c) => c.messageId === 'corrected')?.content, '$99元$');
  assert.equal(h.candidates().some((c) => c.messageId === 'user'), false);
});
