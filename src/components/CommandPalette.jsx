import React, { useEffect, useMemo, useRef, useState } from 'react';

// ⌘K task switcher: fuzzy-filter, keyboard-driven (↑/↓/↵/esc). Switching only —
// metadata editing lives in TasksManager. Hidden tasks are excluded (that's the
// point of hiding); reach them via "Manage tasks".
export default function CommandPalette({ reviews, currentId, onSelect, onClose, onManage }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return reviews
      .filter((r) => !r.hidden)
      .filter((r) => !s || `${r.name || r.title} ${r.project || ''} ${r.id}`.toLowerCase().includes(s))
      .sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || (a.name || a.title).localeCompare(b.name || b.title));
  }, [reviews, q]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector('.cmdk-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; if (r) { onSelect(r.id); onClose(); } }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={inputRef} className="cmdk-input" placeholder="Switch task…"
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <div className="cmdk-list" ref={listRef}>
          {rows.length === 0 && <div className="cmdk-empty">No matching tasks.</div>}
          {rows.map((r, i) => (
            <button key={r.id} className={`cmdk-row ${i === active ? 'active' : ''} ${r.id === currentId ? 'current' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => { onSelect(r.id); onClose(); }}>
              <span className="cmdk-star">{r.starred ? '★' : ''}</span>
              <span className="cmdk-name">{r.name || r.title}</span>
              {r.project && <span className="cmdk-proj">{r.project}</span>}
              {r.id === currentId && <span className="cmdk-cur">current</span>}
            </button>
          ))}
        </div>
        <div className="cmdk-foot">
          <span className="cmdk-hint">↑↓ navigate · ↵ open · esc close</span>
          <button className="cmdk-manage" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onClose(); onManage(); }}>⚙ Manage tasks</button>
        </div>
      </div>
    </div>
  );
}
