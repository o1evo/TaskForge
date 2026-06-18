import React, { useEffect, useRef } from 'react';
import { marked } from 'marked';
import { highlight, langForTag } from '../highlight.js';

// Full Markdown renderer (headings, lists, GFM tables, task lists, blockquotes,
// fenced code, links). Offline — `marked` is bundled, no network. Code fences
// are highlighted with the same offline Prism setup the diff/chat use, applied
// after render so we don't depend on marked's per-version renderer API.
//
// Content is author/Claude-written and this tool is localhost single-user, so we
// render marked's HTML directly (no sanitizer); don't point this at untrusted md.
//
// `breaks` controls whether a single newline becomes a <br>. Long-form docs (QA
// plan) want false (paragraph wrapping); chat comments want true (GitHub-style,
// so a line break in the textarea shows up). Options are passed per-parse so the
// two callers don't fight over a global setting.
export default function Markdown({ text, breaks = false }) {
  const ref = useRef(null);
  const html = marked.parse(text || '', { gfm: true, breaks });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('pre > code').forEach((el) => {
      const cls = Array.from(el.classList).find((c) => c.startsWith('language-'));
      const lang = cls ? langForTag(cls.slice('language-'.length)) : null;
      if (!lang) return;
      const out = highlight(el.textContent, lang);
      if (out != null) el.innerHTML = out;
    });
  }, [html]);

  return <div className="md-body" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
