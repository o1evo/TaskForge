import React, { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import { copyText, inHost, getSendContext } from '../bridge.js';

// Per-send auto-ask methods offered by the Send ▾ menu (only inside the
// extension). The choice is persisted globally in localStorage and read by
// App.send at send time, so it's the source of truth for behaviour; each menu
// just reflects/updates it.
const SEND_MODE_KEY = 'taskforge.sendMode';
const SEND_MODES = [
  { id: 'deeplink-root', label: 'Open chat (paste)',
    hint: 'Reopen your root chat with the question staged — press Enter (or ⌘V + Enter if it is already open).' },
  { id: 'headless-reviewer', label: 'Headless — new reviewer',
    hint: 'A separate headless reviewer answers on its own — no window, no paste. Never touches your live chat. Zero-touch.' },
  { id: 'headless-root', label: 'Headless — same chat',
    hint: 'Resume your root chat headlessly. Full context, but if that chat is open interactively the resume can conflict/fail.' },
];
function readSendMode() {
  try { return localStorage.getItem(SEND_MODE_KEY) || SEND_MODES[0].id; } catch { return SEND_MODES[0].id; }
}

// Hidden for now: the Send ▾ method picker. When false, Send is a plain button and
// auto-ask always uses "open chat (paste)" (see App.send). Flip to true to bring
// the menu back.
const SEND_MENU_ENABLED = false;

// A chat thread (per-hunk or general). Renders messages and an input that posts
// a role:"author" message. Reviewer replies arrive via polling. When `onDelete`
// is supplied, each message gets a × to remove it (onDelete(messageId)).
//
// `target` is the thread's unique key (e.g. "general", "src/foo.js#0", a finding
// id, or "log:intro"). When supplied we surface it as a copyable chip so it's
// trivial to reference the exact thread in a chat ("answer thread <target>").
export default function Thread({ messages, onSend, onDelete, compact, target }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendMode, setSendMode] = useState(readSendMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const host = inHost();
  const curMode = SEND_MODES.find((m) => m.id === sendMode) || SEND_MODES[0];
  const pending = messages.filter((m) => m.role === 'author' && !m.answered).length;

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  function pickMode(id) {
    try { localStorage.setItem(SEND_MODE_KEY, id); } catch { /* ignore */ }
    setSendMode(id);
    setMenuOpen(false);
  }

  async function copyId() {
    await copyText(target);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  async function remove(m) {
    if (!onDelete) return;
    if (!window.confirm('Delete this comment? This cannot be undone.')) return;
    try {
      await onDelete(m.id);
    } catch (err) {
      alert(err.message);
    }
  }

  async function send(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t);
      setText('');
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`thread ${compact ? 'thread-compact' : ''}`}>
      {target && (
        <div className="thread-id" title="This thread's unique id — reference it in chat">
          <span className="thread-id-label">thread</span>
          <button
            type="button"
            className={`thread-id-chip ${copied ? 'copied' : ''}`}
            onClick={copyId}
            title="Copy thread id"
          >
            <code>{target}</code>
            <span className="thread-id-copy">{copied ? '✓' : '⧉'}</span>
          </button>
        </div>
      )}
      {messages.length === 0 && <div className="thread-empty">No messages yet.</div>}
      {messages.map((m) => (
        <div key={m.id} className={`msg msg-${m.role}`}>
          <div className="msg-head">
            <span className="msg-role">{m.role}</span>
            {m.role === 'author' && (
              <span className={`msg-status ${m.answered ? 'answered' : 'pending'}`}>
                {m.answered ? 'answered' : 'awaiting reviewer'}
              </span>
            )}
            <span className="msg-ts">{fmt(m.ts)}</span>
            {onDelete && (
              <button
                type="button"
                className="msg-delete"
                title="delete this comment"
                onClick={() => remove(m)}
              >
                ×
              </button>
            )}
          </div>
          <Markdown text={m.text} breaks />
        </div>
      ))}
      <form className="thread-form" onSubmit={send}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(e);
          }}
          placeholder="Ask the reviewer a question…  (⌘/Ctrl+Enter to send)"
          rows={compact ? 2 : 3}
        />
        <div className="thread-send" ref={menuRef}>
          <button
            type="submit"
            className={`thread-send-main ${host && SEND_MENU_ENABLED ? 'has-caret' : ''}`}
            disabled={sending || !text.trim()}
            title={host && SEND_MENU_ENABLED ? `Auto-ask: ${curMode.label} — ${curMode.hint}` : undefined}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          {host && SEND_MENU_ENABLED && (
            <button
              type="button"
              className="thread-send-caret"
              title="Choose how auto-ask replies"
              aria-label="Choose auto-ask method"
              disabled={sending}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ▾
            </button>
          )}
          {host && SEND_MENU_ENABLED && menuOpen && (() => {
            const ctx = getSendContext();
            return (
              <div className="thread-send-menu" role="menu">
                <div className="thread-send-menu-head">Auto-ask replies via</div>
                {SEND_MODES.map((m) => {
                  // "Same chat" can't resume the root session while it's open in a client.
                  const disabled = m.id === 'headless-root' && ctx.primaryOpen;
                  return (
                    <button
                      type="button"
                      key={m.id}
                      disabled={disabled}
                      className={`thread-send-opt ${m.id === sendMode ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                      title={disabled
                        ? 'Your root chat is open right now — it can’t be resumed headlessly. Close it, or use “new reviewer”.'
                        : m.hint}
                      onClick={() => { if (!disabled) pickMode(m.id); }}
                    >
                      <span className="thread-send-check">{m.id === sendMode ? '✓' : ''}</span>
                      <span className="thread-send-opt-label">{m.label}</span>
                      {disabled && <span className="thread-send-opt-note">chat open</span>}
                    </button>
                  );
                })}
                <div className="thread-send-menu-foot">Remembered for next time</div>
              </div>
            );
          })()}
        </div>
      </form>
      {pending > 0 && (
        <div className="thread-pending-note">
          {pending} question{pending > 1 ? 's' : ''} awaiting a reviewer reply.
        </div>
      )}
    </div>
  );
}

function fmt(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
