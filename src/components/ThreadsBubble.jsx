import React, { useMemo, useState } from 'react';
import Thread from './Thread.jsx';
import ChatIcon from './ChatIcon.jsx';

// A floating chat bubble (fixed bottom-right) that holds the threads index for
// one tab. Scope decides what it shows and hides the other tab's threads:
//   scope="review" → code-review threads (general / findings / hunks / lines) + a
//                    Findings index. Excludes Log-page threads.
//   scope="log"    → Log-page threads only (keys prefixed "log:").
// Every comment row expands inline to read/reply without leaving the tab; review
// rows also jump to their target in the diff via onJump.

const SEV_ORDER = ['blocker', 'high', 'medium', 'low', 'resolved', 'note'];
const SEV_LABEL = { blocker: 'Blocker', high: 'High', medium: 'Medium', low: 'Low', resolved: 'Resolved', note: 'Note' };

export default function ThreadsBubble({
  scope, hunks, threads, anchors,
  onSend, onDelete, onDeleteThread, onDeleteAnchor, onSetAnchorState, onJump,
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('comments'); // review scope only: 'comments' | 'findings'
  const [expanded, setExpanded] = useState(null); // thread key shown inline
  const [commentFilter, setCommentFilter] = useState('all'); // all | pending | hidden

  const isLog = scope === 'log';

  const allRows = useMemo(() => buildComments(hunks, threads, anchors), [hunks, threads, anchors]);
  const rows = allRows.filter((r) => (isLog ? r.kind === 'log' : r.kind !== 'log'));
  const shownRows = rows.filter((c) => (
    commentFilter === 'pending' ? c.pending > 0
      : commentFilter === 'hidden' ? c.state === 'hidden'
        : true));

  const findings = useMemo(() => (isLog ? [] : flattenFindings(hunks)), [hunks, isLog]);
  const bySev = SEV_ORDER
    .map((sev) => [sev, findings.filter((f) => f.sev === sev)])
    .filter(([, xs]) => xs.length);

  const totalPending = rows.reduce((n, c) => n + c.pending, 0);

  function removeRow(c) {
    const fn = c.kind === 'log' ? onDeleteAnchor : onDeleteThread;
    if (!fn) return;
    if (!window.confirm(`Delete this ${c.kind === 'log' ? 'comment' : 'thread'} and its messages? This cannot be undone.`)) return;
    fn(c.key);
  }

  return (
    <div className="tf-bubble" data-taskforge-ui>
      {open && (
        <div className="tf-bubble-panel">
          <div className="tf-bubble-head">
            <strong>{isLog ? 'Log threads' : 'Review threads'}</strong>
            {totalPending > 0 && <span className="tf-bubble-pending">{totalPending} pending</span>}
            <button className="tf-bubble-x" title="Close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {!isLog && (
            <div className="tf-bubble-tabs">
              <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>
                Comments{rows.length > 0 && <span className="tf-tab-count">{rows.length}</span>}
              </button>
              <button className={tab === 'findings' ? 'active' : ''} onClick={() => setTab('findings')}>
                Findings{findings.length > 0 && <span className="tf-tab-count">{findings.length}</span>}
              </button>
            </div>
          )}

          <div className="tf-bubble-body">
            {(isLog || tab === 'comments') && (
              <>
                <div className="rs-filter">
                  {['all', 'pending', 'hidden'].map((f) => (
                    <button key={f} className={commentFilter === f ? 'active' : ''} onClick={() => setCommentFilter(f)}>{f}</button>
                  ))}
                </div>
                {shownRows.length === 0 && <div className="rs-empty">No threads.</div>}
                {shownRows.map((c) => (
                  <div key={c.key} className={`tf-thread ${c.state === 'hidden' ? 'rs-row-hidden' : ''}`}>
                    <div className="rs-row">
                      <button className="rs-item rs-comment" onClick={() => setExpanded((k) => (k === c.key ? null : c.key))}
                        title={c.preview}>
                        <span className={`rs-kind rs-kind-${c.kind}`}>{c.label}</span>
                        {c.state === 'hidden' && <span className="rs-tag-hidden">hidden</span>}
                        <span className="rs-item-text">{c.preview}</span>
                        <span className="rs-counts">
                          {c.count}{c.pending > 0 && <span className="rs-pending-dot" title={`${c.pending} awaiting reply`}> ●</span>}
                        </span>
                      </button>
                      <span className="rs-row-acts">
                        {!isLog && c.domId && onJump && (
                          <button className="rs-act" title="Jump to it in the diff" aria-label="Jump"
                            onClick={() => onJump(c.domId)}>↦</button>
                        )}
                        {c.kind === 'log' && c.state === 'hidden' && onSetAnchorState && (
                          <button className="rs-act" title="Unhide on the Log page" aria-label="Unhide"
                            onClick={() => onSetAnchorState(c.key, 'open')}>↺</button>
                        )}
                        {((c.kind === 'log' && onDeleteAnchor) || (c.kind !== 'log' && onDeleteThread)) && (
                          <button className="rs-act rs-act-danger" title="Delete thread" aria-label="Delete"
                            onClick={() => removeRow(c)}>🗑</button>
                        )}
                      </span>
                    </div>
                    {expanded === c.key && (
                      <div className="tf-thread-body">
                        <Thread messages={threads[c.key] || []} target={c.key} onSend={(t) => onSend(c.key, t)}
                          onDelete={onDelete && ((mid) => onDelete(c.key, mid))} compact />
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {!isLog && tab === 'findings' && (
              <>
                {bySev.length === 0 && <div className="rs-empty">No findings.</div>}
                {bySev.map(([sev, xs]) => (
                  <div key={sev} className="rs-group">
                    <div className={`rs-grouphead sev-${sev}`}>{SEV_LABEL[sev] || sev} · {xs.length}</div>
                    {xs.map((f) => (
                      <button key={f.id} className={`rs-item sev-${f.sev}`} onClick={() => onJump && onJump(f.domId)}
                        title={f.note || f.tag}>
                        <span className="rs-dot" />
                        <span className="rs-item-text">{f.tag || f.note || '(finding)'}</span>
                        <span className="rs-item-file">{shortFile(f.file)}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      <button className={`tf-bubble-fab ${totalPending > 0 ? 'has-pending' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={isLog ? 'Log threads' : 'Review threads'}>
        <ChatIcon size={22} strokeWidth={1.9} />
        {totalPending > 0 && <span className="tf-bubble-fab-badge">{totalPending}</span>}
      </button>
    </div>
  );
}

// Flatten annotations into a findings list tagged with file + scroll target.
function flattenFindings(hunks) {
  const out = [];
  for (const h of hunks || []) {
    for (const a of h.annotations || []) {
      out.push({ ...a, file: h.file, domId: `f-${a.id}`, sev: (a.severity || 'note').toLowerCase() });
    }
  }
  return out;
}

// Map each non-empty thread to a bubble row: a human label, a scroll target
// (domId) when it lives in the diff, message count, pending count, and (for log
// anchors) the anchored quote as its label/preview.
function buildComments(hunks, threads, anchors) {
  const hunkIds = new Set((hunks || []).map((h) => h.id));
  const annById = new Map();
  for (const h of hunks || []) for (const a of h.annotations || []) annById.set(a.id, { ...a, file: h.file });

  const rows = [];
  for (const [key, msgs] of Object.entries(threads || {})) {
    if (!msgs || !msgs.length) continue;
    const pending = msgs.filter((m) => m.role === 'author' && !m.answered).length;
    let preview = (msgs[msgs.length - 1].text || '').replace(/\s+/g, ' ').slice(0, 60);
    let label = key, kind = 'other', domId = null;

    if (key === 'general') { label = 'General'; kind = 'general'; }
    else if (annById.has(key)) { const a = annById.get(key); label = a.tag || 'finding'; kind = 'finding'; domId = `f-${key}`; }
    else if (hunkIds.has(key)) { label = `${shortFile(key.split('#')[0])} hunk`; kind = 'hunk'; domId = `h-${key}`; }
    else if (/#L\d+$/.test(key)) { const n = key.match(/#L(\d+)$/)[1]; label = `Line ${n}`; kind = 'line'; domId = `ln-${key}`; }
    else if (key.includes('::')) { label = key.split('::').pop(); kind = 'finding'; domId = null; }
    else if (/^log:/.test(key)) {
      // A Log-tab thread: a page section (taskforge.Thread) or a free-selection
      // anchor. When it's an anchored comment, prefer its quote as the label.
      const q = anchors && anchors[key] && anchors[key].quote;
      label = q ? truncate(q.replace(/\s+/g, ' '), 40) : 'Log page';
      kind = 'log';
      domId = null;
    }
    const state = (anchors && anchors[key] && anchors[key].state) || 'open';
    rows.push({ key, label, kind, domId, count: msgs.length, pending, preview, state });
  }
  const order = { finding: 0, line: 1, hunk: 2, general: 3, log: 4, other: 5 };
  rows.sort((a, b) => (b.pending > 0) - (a.pending > 0) || order[a.kind] - order[b.kind]);
  return rows;
}

function shortFile(path) {
  const p = String(path || '');
  return p.split('/').pop() || p;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
