const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../bridge.js'), 'utf8');

function harness() {
  const nodes = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const writes = [];
  const warnings = [];
  const formula = { textContent: '100元' };
  const message = {
    dataset: { messageId: 'selected' },
    innerText: '这是一段两个回复都可能使用的相同开头。100元',
    querySelectorAll: () => [formula],
  };
  const boundary = { nodeType: 1, closest: (selector) => selector === '.katex' ? null : message };
  const range = {
    collapsed: false, startContainer: boundary, endContainer: boundary,
    cloneRange() { return this; }, intersectsNode: () => true,
    cloneContents() {
      const fragment = { nodeType: 11, childNodes: [] };
      const clone = { replaceWith(node) { fragment.childNodes = [node]; } };
      fragment.querySelectorAll = () => [clone];
      return fragment;
    },
  };
  const window = {
    addEventListener: (name, handler) => windowListeners.set(name, handler),
    dispatchEvent() {}, setTimeout() {},
    getSelection: () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => range }),
  };
  const document = {
    documentElement: { dataset: {} },
    body: { append: (node) => nodes.set(node.id, node) },
    getElementById: (id) => nodes.get(id),
    addEventListener: (name, handler) => documentListeners.set(name, handler),
    createElement: () => ({ style: {}, handlers: new Map(),
      addEventListener(name, handler) { this.handlers.set(name, handler); },
      setAttribute() {}, remove() { nodes.delete(this.id); },
    }),
    createTextNode: (nodeValue) => ({ nodeType: 3, nodeValue }),
  };
  vm.runInNewContext(source, {
    window, document, location: { origin: 'https://chatgpt.com' },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_FRAGMENT_NODE: 11 },
    CustomEvent: class {}, navigator: { clipboard: { async writeText(text) { writes.push(text); } } },
    console: { info() {}, error() {}, warn: (_, details) => warnings.push(details) },
  });
  return {
    writes, warnings,
    cache(candidate) {
      windowListeners.get('message')({ source: window, origin: 'https://chatgpt.com', data: {
        source: 'chatgpt-math-source-probe', type: 'candidate', candidates: [candidate],
      } });
    },
    async copy() {
      documentListeners.get('selectionchange')();
      nodes.get('chatgpt-math-probe-copy-button').handlers.get('mousedown')({ preventDefault() {} });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('selected formula reaches clipboard with literal double dollars', async () => {
  const h = harness();
  h.cache({ messageId: 'selected', content: '金额 $100元$', assembled: true });
  await h.copy();
  assert.deepEqual(h.writes, ['$$100元$$']);
});

test('new reconstructed correction replaces a longer cached snapshot', async () => {
  const h = harness();
  h.cache({ messageId: 'selected', content: '$100元$、$200元$', assembled: true });
  h.cache({ messageId: 'selected', content: '$99元$', assembled: true });
  await h.copy();
  assert.deepEqual(h.writes, ['$$99元$$']);
});

test('another message with an identical opening is never copied as this message', async () => {
  const h = harness();
  h.cache({ messageId: 'other', content: '这是一段两个回复都可能使用的相同开头。$200元$' });
  await h.copy();
  assert.equal(h.writes.length, 0);
  assert.equal(h.warnings[0].reason, 'source-missing');
  assert.equal(h.warnings[0].messageId, 'selected');
});

test('count mismatch leaves clipboard unchanged and reports both counts', async () => {
  const h = harness();
  h.cache({ messageId: 'selected', content: '$100元$、$200元$' });
  await h.copy();
  assert.equal(h.writes.length, 0);
  assert.equal(h.warnings[0].reason, 'formula-count-mismatch');
  assert.equal(h.warnings[0].renderedFormulaCount, 1);
  assert.equal(h.warnings[0].sourceFormulaCount, 2);
});
