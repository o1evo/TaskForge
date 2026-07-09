import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// In-page find. The app runs inside a cross-origin iframe in the VS Code webview,
// so the editor's native ⌘F can't search our content — this bar does.
//
// It does its OWN match traversal instead of window.find(): window.find moves the
// document Selection to each hit, which blurs our input (you could only type one
// char before focus jumped away) and returns a bare bool (no count). Here we walk
// the visible text nodes ourselves, collect every match range, paint them with the
// CSS Custom Highlight API (no DOM mutation), and track idx/total — so the input
// keeps focus the whole time and we can show "3 / 17".
//
// ↵ next, ⇧↵ prev, esc closes. Tagged data-taskforge-ui so the comment layer
// (and our own traversal) ignore it.

const ALL = 'taskforge-find';
const CUR = 'taskforge-find-current';
const supportsHighlight = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';

// Only text the user can actually see, and never our own chrome. Mirrors the old
// window.find "visible text only" behaviour so hidden/inactive tabs don't match.
function isVisible(node) {
  const el = node.parentElement;
  if (!el) return false;
  if (el.closest('[data-taskforge-ui]')) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  return !!(el.offsetParent || el.getClientRects().length);
}

// Collect a Range for every case-insensitive occurrence of `query` in visible text.
function collectMatches(query) {
  if (!query) return [];
  const needle = query.toLowerCase();
  const ranges = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeValue && isVisible(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  let node;
  while ((node = walker.nextNode())) {
    const hay = node.nodeValue.toLowerCase();
    let from = 0, at;
    while ((at = hay.indexOf(needle, from)) !== -1) {
      const r = document.createRange();
      r.setStart(node, at);
      r.setEnd(node, at + needle.length);
      ranges.push(r);
      from = at + needle.length;
    }
  }
  return ranges;
}

function paint(ranges, idx) {
  if (!supportsHighlight) return;
  CSS.highlights.set(ALL, new Highlight(...ranges));
  const cur = ranges[idx];
  if (cur) CSS.highlights.set(CUR, new Highlight(cur));
  else CSS.highlights.delete(CUR);
}

function clearPaint() {
  if (!supportsHighlight) return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CUR);
}

export default function FindBar({ onClose }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  // Recompute matches when the query changes. (Content changes on the 3s poll are
  // not tracked — re-type or hit ↵ to refresh; keeps this cheap and predictable.)
  const matches = useMemo(() => collectMatches(q), [q]);
  const total = matches.length;

  // Any new query starts at the first match.
  useEffect(() => { setIdx(0); }, [q]);

  // Paint + scroll the current match into view, without ever touching the input's
  // focus or the document Selection. useLayoutEffect so the highlight lands before
  // the browser paints the scroll.
  useLayoutEffect(() => {
    if (!total) { clearPaint(); return; }
    const safe = ((idx % total) + total) % total;
    paint(matches, safe);
    matches[safe]?.startContainer?.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [matches, idx, total]);

  // Ranges are live DOM objects — drop the highlights when the bar closes.
  useEffect(() => () => clearPaint(), []);

  const step = (delta) => { if (total) setIdx((i) => (((i + delta) % total) + total) % total); };

  // Copy text through the same bridge App uses: inside the cross-origin VS Code
  // webview iframe the async Clipboard API may be blocked, so also postMessage the
  // text up to the extension host, which always has clipboard access.
  function copyText(text) {
    if (!text) return;
    try { if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(() => {}); } catch { /* ignore */ }
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'taskforge-clipboard-write', text }, '*'); } catch { /* ignore */ }
  }

  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (!mod) return;
    const k = e.key.toLowerCase();
    // Keep ⌘/Ctrl+A/C/V scoped to THIS input. In the VS Code webview these keys
    // are otherwise captured page-wide (⌘A selected the whole page, ⌘C hit App's
    // page-copy). stopPropagation keeps App's document handler out; we own A + C.
    if (k === 'a') {
      e.preventDefault(); e.stopPropagation();
      inputRef.current?.select();
    } else if (k === 'c') {
      e.stopPropagation();
      const el = inputRef.current;
      const sel = el ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0) : '';
      copyText(sel);
    } else if (k === 'v' || k === 'x') {
      // Native paste/cut into the input work (iframe has clipboard-read/write);
      // just stop the event escaping to page-level handlers.
      e.stopPropagation();
      if (k === 'x') {
        const el = inputRef.current;
        if (el) copyText(el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
      }
    }
  }

  const miss = q && total === 0;
  const shown = total ? ((idx % total) + total) % total + 1 : 0;

  return (
    <div className="findbar" data-taskforge-ui>
      <input ref={inputRef} className={`findbar-input ${miss ? 'miss' : ''}`} placeholder="Find on page…"
        value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
      <span className="findbar-status">
        {q ? (total ? `${shown} / ${total}` : 'no matches') : ''}
      </span>
      <button className="findbar-btn" title="Previous (⇧↵)" aria-label="Previous match" disabled={!total} onClick={() => step(-1)}>↑</button>
      <button className="findbar-btn" title="Next (↵)" aria-label="Next match" disabled={!total} onClick={() => step(1)}>↓</button>
      <button className="findbar-btn" title="Close (esc)" aria-label="Close find" onClick={onClose}>✕</button>
    </div>
  );
}
