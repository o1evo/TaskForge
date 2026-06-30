import React, { useEffect, useMemo, useRef, useState } from 'react';

// The task switcher: replaces the bare <select>. Reads per-page metadata
// (name override / starred / hidden / project) folded into the reviews list, and
// writes it back via onMeta (→ .wcc/pages.json). Starred pin to the top of each
// group; hidden pages drop out until "show hidden"; pages group by project.
export default function PageSwitcher({ reviews, currentId, onSelect, onMeta }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const cur = reviews.find((r) => r.id === currentId);
  const hiddenCount = reviews.filter((r) => r.hidden).length;
  const q = filter.trim().toLowerCase();

  // Group by project (starred first within each group); flat when no page has a project.
  const groups = useMemo(() => {
    let rows = reviews.filter((r) => showHidden || !r.hidden);
    if (q) rows = rows.filter((r) => `${r.name || r.title} ${r.project || ''}`.toLowerCase().includes(q));
    const anyProject = reviews.some((r) => r.project);
    const byProj = {};
    for (const r of rows) {
      const k = r.project || (anyProject ? '— no project' : '');
      (byProj[k] ||= []).push(r);
    }
    const cmp = (a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || (a.name || a.title).localeCompare(b.name || b.title);
    return Object.keys(byProj).sort().map((k) => ({ project: k, rows: byProj[k].sort(cmp) }));
  }, [reviews, q, showHidden]);

  const patch = (id, p) => onMeta(id, p);
  function rename(r) { const v = window.prompt('Display name (blank to clear):', r.name || ''); if (v !== null) patch(r.id, { name: v.trim() }); }
  function setProject(r) { const v = window.prompt('Project (blank to clear):', r.project || ''); if (v !== null) patch(r.id, { project: v.trim() }); }

  return (
    <div className="pswitch" ref={ref}>
      <button className="pswitch-btn" onClick={() => setOpen((o) => !o)} title="Switch task">
        {cur?.starred && <span className="pswitch-star">★</span>}
        <span className="pswitch-cur">{cur ? (cur.name || cur.title) : 'Select task…'}</span>
        <span className="pswitch-caret">▾</span>
      </button>
      {open && (
        <div className="pswitch-panel">
          <input className="pswitch-filter" placeholder="Filter tasks…" value={filter}
            onChange={(e) => setFilter(e.target.value)} autoFocus />
          <div className="pswitch-list">
            {groups.length === 0 && <div className="pswitch-empty">No tasks.</div>}
            {groups.map((g) => (
              <div key={g.project} className="pswitch-group">
                {g.project && <div className="pswitch-grouphead">{g.project}</div>}
                {g.rows.map((r) => (
                  <div key={r.id} className={`pswitch-row ${r.id === currentId ? 'active' : ''} ${r.hidden ? 'is-hidden' : ''}`}>
                    <button className="pswitch-name" title={r.title} onClick={() => { onSelect(r.id); setOpen(false); }}>
                      {r.starred && <span className="pswitch-rowstar">★</span>}
                      <span className="pswitch-label">{r.name || r.title}</span>
                      {r.name && <span className="pswitch-id">{r.id}</span>}
                    </button>
                    <span className="pswitch-acts">
                      <button className={`ps-act ${r.starred ? 'on' : ''}`} title={r.starred ? 'Unstar' : 'Star'} aria-label="Star"
                        onClick={() => patch(r.id, { starred: !r.starred })}>{r.starred ? '★' : '☆'}</button>
                      <button className="ps-act" title="Rename" aria-label="Rename" onClick={() => rename(r)}>✎</button>
                      <button className="ps-act" title="Set project" aria-label="Set project" onClick={() => setProject(r)}>🏷</button>
                      <button className="ps-act" title={r.hidden ? 'Unhide' : 'Hide'} aria-label={r.hidden ? 'Unhide' : 'Hide'}
                        onClick={() => patch(r.id, { hidden: !r.hidden })}>{r.hidden ? '↺' : '⊘'}</button>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {hiddenCount > 0 && (
            <button className="pswitch-showhidden" onClick={() => setShowHidden((s) => !s)}>
              {showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
