// Runs in the extension's isolated world. Data never leaves this page/extension.
(() => {
  'use strict';

  const EVENT_SOURCE = 'chatgpt-math-source-probe';
  const BUILD_VERSION = '1.4.1';
  const messageCache = new Map();
  const captureStatus = new Map();
  const captureCounts = new Map();
  let lastSelectedMessageId = null;
  let lastSelectedRange = null;

  function publishStatus() {
    document.documentElement.dataset.chatgptMathProbe = `captured:${messageCache.size}`;
  }

  function notify(message, kind = 'info') {
    document.getElementById('chatgpt-math-probe-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'chatgpt-math-probe-toast';
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:92px', 'z-index:2147483647',
      'max-width:420px', 'padding:10px 12px', 'border:1px solid #141413',
      'border-radius:0', 'font:500 12px/1.5 "JetBrains Mono",ui-monospace,monospace',
      `color:${kind === 'error' ? '#762c12' : '#141413'}`,
      `background:${kind === 'error' ? '#ffdbd0' : '#faf9f5'}`,
      'box-shadow:none'
    ].join(';');
    (document.body ?? document.documentElement).append(toast);
    window.setTimeout(() => toast.remove(), 5000);
  }

  function selectedAssistantMessage() {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest('[data-message-author-role="assistant"]') ?? null;
  }

  async function copyRawMessage(messageId) {
    const candidate = messageId ? messageCache.get(messageId) : null;

    if (!candidate) {
      console.warn('[ChatGPT Math Probe] no cached raw content for the selected assistant message.', {
        messageId: messageId ?? null,
        cachedMessageIds: [...messageCache.keys()],
      });
      notify('Math Probe: 未找到这条 assistant 回复的公式源码缓存。请先等待候选日志出现，再在同一条回复内单击。', 'error');
      return;
    }

    await navigator.clipboard.writeText(candidate.content);
    console.info('[ChatGPT Math Probe] copied raw message content.', {
      messageId,
      texCommands: candidate.texCommands ?? [],
    });
    notify(`Math Probe: 已复制原始回复（message ${messageId.slice(0, 8)}…；${(candidate.texCommands ?? []).join(', ')}）`);
  }

  function rawFormulas(markdown) {
    // The POC covers ChatGPT's common \[...\], $$...$$, \(...\), and $...$ forms.
    return markdown.match(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|(?<!\$)\$(?!\$)(?:\\.|[^$\\])+\$(?!\$)/g) ?? [];
  }

  function keepMoreCompleteCandidate(existing, incoming) {
    // Stream decoders send reconstructed snapshots, including explicit edits
    // that can shorten a reply. Do not undo those corrections by length.
    if (incoming.assembled) return incoming;
    if (!existing) return incoming;
    const existingFormulaCount = rawFormulas(existing.content).length;
    const incomingFormulaCount = rawFormulas(incoming.content).length;
    if (incomingFormulaCount !== existingFormulaCount) {
      return incomingFormulaCount > existingFormulaCount ? incoming : existing;
    }
    return incoming.content.length > existing.content.length ? incoming : existing;
  }

  function geminiStyleFormula(raw) {
    const compact = (body) => body.trim().replace(/\s+/g, ' ');
    const body = raw.startsWith('\\[') && raw.endsWith('\\]')
      ? raw.slice(2, -2)
      : raw.startsWith('$$') && raw.endsWith('$$')
        ? raw.slice(2, -2)
        : raw.startsWith('\\(') && raw.endsWith('\\)')
          ? raw.slice(2, -2)
          : raw.startsWith('$') && raw.endsWith('$')
            ? raw.slice(1, -1)
            : raw;
    return `$$${compact(body)}$$`;
  }

  // A final guard for cases where ChatGPT exposes a formula as selectable
  // LaTeX text beside its rendered KaTeX node. It also converts that form.
  function forceDoubleDollarDelimiters(text) {
    return rawFormulas(text).reduce(
      // Use a callback: a replacement string interprets $$ as a special token
      // and would silently collapse our intended double-dollar delimiters.
      (result, raw) => result.replace(raw, () => geminiStyleFormula(raw)),
      text,
    );
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function assistantForNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest('[data-message-author-role="assistant"]') ?? null;
  }

  function formulaContaining(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest('.katex') ?? null;
  }

  function serializeFragment(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') return '\n';
    const content = [...node.childNodes].map(serializeFragment).join('');
    if (node.nodeType === Node.ELEMENT_NODE && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE)$/i.test(node.tagName)) {
      return `${content}\n\n`;
    }
    return content;
  }

  async function copySelectedContent(savedRange = null) {
    const selection = window.getSelection();
    const originalRange = savedRange ?? (selection?.rangeCount && !selection.isCollapsed
      ? selection.getRangeAt(0).cloneRange()
      : null);
    if (!originalRange || originalRange.collapsed) {
      notify('Math Probe: 请先在同一条 assistant 回复内拖选内容。', 'error');
      return;
    }

    const message = assistantForNode(originalRange.startContainer);
    if (!message || message !== assistantForNode(originalRange.endContainer)) {
      notify('Math Probe: 当前 POC 只支持同一条 assistant 回复内的选区。', 'error');
      return;
    }

    const sourceFormulas = [...message.querySelectorAll('.katex')];
    const touchedFormulas = sourceFormulas.filter((formula) => originalRange.intersectsNode(formula));
    const candidate = messageCache.get(message.dataset.messageId);
    const sourceTeX = candidate ? rawFormulas(candidate.content) : [];
    if (touchedFormulas.length && (!candidate || sourceTeX.length !== sourceFormulas.length)) {
      console.warn('[ChatGPT Math Probe] copy blocked', {
        version: BUILD_VERSION,
        reason: candidate ? 'formula-count-mismatch' : 'source-missing',
        messageId: message.dataset.messageId,
        renderedFormulaCount: sourceFormulas.length,
        sourceFormulaCount: candidate ? sourceTeX.length : null,
        selectedFormulaCount: touchedFormulas.length,
        cachedMessageCount: messageCache.size,
        sourceTransport: candidate?.transport ?? null,
        captureStatus: Object.fromEntries(captureStatus),
        captureCounts: Object.fromEntries(captureCounts),
      });
      notify(candidate
        ? `Math Probe: 公式数量未对齐（页面 ${sourceFormulas.length}，源码 ${sourceTeX.length}）。请等待回复完成；详情见 Console 的 copy blocked。`
        : 'Math Probe: 尚未捕获这条回复的源码。请等待回复完成；详情见 Console 的 copy blocked。', 'error');
      return;
    }

    // If a drag begins or ends inside visual KaTeX, include the whole source formula.
    const range = originalRange.cloneRange();
    const startFormula = formulaContaining(range.startContainer);
    const endFormula = formulaContaining(range.endContainer);
    if (startFormula && message.contains(startFormula)) range.setStartBefore(startFormula);
    if (endFormula && message.contains(endFormula)) range.setEndAfter(endFormula);

    const fragment = range.cloneContents();
    const clonedFormulas = [...fragment.querySelectorAll('.katex')];
    if (clonedFormulas.length !== touchedFormulas.length) {
      notify('Math Probe: 选区中的公式结构不完整，请重新选中该公式。', 'error');
      return;
    }

    const formulaSlots = clonedFormulas.map((formula, index) => {
      const sourceIndex = sourceFormulas.indexOf(touchedFormulas[index]);
      const marker = `\uE000MATH_${index}\uE001`;
      const visibleText = touchedFormulas[index].textContent
        .replace(/[\u200B\u2060]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      formula.replaceWith(document.createTextNode(marker));
      return { marker, visibleText, latex: geminiStyleFormula(sourceTeX[sourceIndex]) };
    });

    let output = serializeFragment(fragment).replace(/\n{3,}/g, '\n\n').trim();
    // Some ChatGPT formula wrappers clone an accessibility text sibling in addition
    // to .katex. Remove that adjacent visual duplicate before inserting TeX.
    for (const slot of formulaSlots) {
      if (!slot.visibleText) continue;
      const marker = escapeRegExp(slot.marker);
      const visible = escapeRegExp(slot.visibleText);
      output = output
        .replace(new RegExp(`${visible}\\s*${marker}`), slot.marker)
        .replace(new RegExp(`${marker}\\s*${visible}`), slot.marker);
    }
    for (const slot of formulaSlots) {
      output = output.replaceAll(slot.marker, () => slot.latex);
    }
    output = forceDoubleDollarDelimiters(output);
    await navigator.clipboard.writeText(output);
    console.info('[ChatGPT Math Probe] copied selected content as Markdown/TeX.', {
      messageId: message.dataset.messageId,
      output,
    });
    notify(`Math Probe v${BUILD_VERSION}: 已复制选中内容（公式使用 $$...$$）。`);
  }

  function ensureCopyButton() {
    if (document.getElementById('chatgpt-math-probe-copy-button')) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', ensureCopyButton, { once: true });
      return;
    }
    const button = document.createElement('button');
    button.id = 'chatgpt-math-probe-copy-button';
    button.type = 'button';
    button.innerHTML = [
      '<span aria-hidden="true" style="font:700 24px/1 Playfair Display,Georgia,serif">∑</span>',
      '<span style="display:grid;gap:2px;text-align:left">',
      '<span style="font:600 13px/1.2 Inter,\'Noto Sans SC\',system-ui,sans-serif">复制选中内容</span>',
      `<span style="font:500 10px/1.2 JetBrains Mono,ui-monospace,monospace;letter-spacing:.06em">LATEX → MARKDOWN · v${BUILD_VERSION}</span>`,
      '</span>'
    ].join('');
    button.setAttribute('aria-label', '复制选中内容为 Gemini 格式 LaTeX');
    button.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:20px', 'z-index:2147483646',
      'min-width:208px', 'display:grid', 'grid-template-columns:28px 1fr',
      'align-items:center', 'gap:10px', 'padding:11px 13px 10px',
      'border:1px solid #141413', 'border-bottom:3px solid #99462a',
      'border-radius:0', 'cursor:pointer', 'color:#faf9f5', 'background:#141413',
      'box-shadow:none', 'transition:background 120ms ease,color 120ms ease'
    ].join(';');
    button.addEventListener('mouseenter', () => {
      button.style.background = '#faf9f5';
      button.style.color = '#141413';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = '#141413';
      button.style.color = '#faf9f5';
    });
    button.addEventListener('mousedown', (event) => {
      // Keep the page selection intact while the user presses the floating control.
      event.preventDefault();
      copySelectedContent(lastSelectedRange).catch((error) => {
        console.error('[ChatGPT Math Probe] could not write selected content to clipboard.', error);
        notify('Math Probe: 写入剪贴板失败，请查看 Console。', 'error');
      });
    });
    document.body.append(button);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== EVENT_SOURCE) return;
    if (data.type === 'capture-status') {
      captureStatus.set(data.transport, data.reason);
      const key = `${data.transport}:${data.reason}`;
      captureCounts.set(key, (captureCounts.get(key) ?? 0) + 1);
      return;
    }
    if (data.type !== 'candidate') return;

    for (const candidate of data.candidates ?? []) {
      if (typeof candidate.messageId !== 'string' || typeof candidate.content !== 'string') continue;
      const key = candidate.messageId ?? `unmapped:${messageCache.size + 1}`;
      const selectedCandidate = keepMoreCompleteCandidate(messageCache.get(key), candidate);
      messageCache.set(key, selectedCandidate);
      console.info('[ChatGPT Math Probe] raw-message candidate', {
        messageId: selectedCandidate.messageId ?? null,
        path: selectedCandidate.path,
        texCommands: selectedCandidate.texCommands ?? [],
        formulaCount: rawFormulas(selectedCandidate.content).length,
        transport: selectedCandidate.transport,
        content: selectedCandidate.content,
      });
    }

    publishStatus();
    window.dispatchEvent(new CustomEvent('chatgpt-math-source-probe:capture', {
      detail: { count: messageCache.size, url: data.url },
    }));
  });

  publishStatus();
  ensureCopyButton();
  document.addEventListener('DOMContentLoaded', ensureCopyButton, { once: true });
  window.addEventListener('load', ensureCopyButton, { once: true });
  console.info('[ChatGPT Math Probe] bridge ready; captured candidates stay local.');

  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const message = assistantForNode(range.startContainer);
    if (message !== assistantForNode(range.endContainer)) return;
    lastSelectedRange = range.cloneRange();
    lastSelectedMessageId = message?.dataset.messageId ?? null;
  }, true);

})();
