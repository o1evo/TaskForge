import React, { useEffect, useRef, useState } from 'react';
import ChatIcon from './ChatIcon.jsx';

// The "chats that took part in this page" index (header control). Lists the AI
// sessions recorded against the task in thread.json `participants`, tool-agnostic
// (claude / gemini / openai / …). Clicking a row asks the host to reopen that
// exact chat — for Claude, straight into the VS Code chat panel via a deep link;
// for other tools, a configured resume command. The ★ marks the primary (root)
// session that built the page — the one the auto-responder reopens.
export default function ChatLinks({ participants, onOpen, onSetPrimary, onUnlink }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const list = Array.isArray(participants) ? participants : [];

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  if (!list.length) return null; // nothing recorded yet → stay out of the way

  // Primary first, then most-recently-active.
  const sorted = list.slice().sort((a, b) => {
    if ((b.role === 'primary') - (a.role === 'primary')) return (b.role === 'primary') - (a.role === 'primary');
    return String(b.lastActive || '').localeCompare(String(a.lastActive || ''));
  });

  return (
    <div className="chatlinks" ref={ref}>
      <button className="chatlinks-btn" onClick={() => setOpen((o) => !o)}
        title="AI chats that took part in this task">
        <span className="chatlinks-ic"><ChatIcon size={15} /></span>
        <span className="chatlinks-count">{list.length}</span>
      </button>
      {open && (
        <div className="chatlinks-menu" role="menu">
          <div className="chatlinks-head">Chats on this task</div>
          {sorted.map((p) => (
            <div key={`${p.tool}:${p.sessionId}`} className={`chatlinks-row ${p.role === 'primary' ? 'is-primary' : ''}`}>
              <button className="chatlinks-open" onClick={() => { onOpen(p); setOpen(false); }}
                title={`Open this ${p.tool} chat`}>
                <span className={`chatlinks-tool tool-${p.tool}`}>{p.tool}</span>
                <span className="chatlinks-label">{p.label || (p.role === 'primary' ? 'root' : 'session')}</span>
                <code className="chatlinks-sid">{shortId(p.sessionId)}</code>
                {p.role === 'primary' && <span className="chatlinks-star" title="Primary (root) session">★</span>}
                <span className="chatlinks-ago">{ago(p.lastActive)}</span>
              </button>
              <div className="chatlinks-acts">
                {p.role !== 'primary' && onSetPrimary && (
                  <button className="chatlinks-act" title="Make this the primary (root) session"
                    onClick={() => onSetPrimary(p)}>☆</button>
                )}
                {onUnlink && (
                  <button className="chatlinks-act chatlinks-act-danger" title="Unlink this chat"
                    onClick={() => { if (window.confirm(`Unlink this ${p.tool} chat from the task?`)) onUnlink(p); }}>×</button>
                )}
              </div>
            </div>
          ))}
          <div className="chatlinks-foot">★ = the session the reviewer reopens</div>
        </div>
      )}
    </div>
  );
}

function shortId(sid) {
  const s = String(sid || '');
  return s.length > 10 ? s.slice(0, 8) + '…' : s;
}

// Compact relative time; falls back to the raw value if unparseable.
function ago(ts) {
  try {
    const then = new Date(ts).getTime();
    if (!Number.isFinite(then)) return '';
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  } catch { return ''; }
}
