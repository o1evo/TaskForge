import React, { useEffect, useRef, useState } from 'react';
import { THEMES, THEME_LIST } from '../themes.js';

// A single header control (🎨) that opens one popover for all appearance
// settings: color Palette, a Transparency slider (0 = solid, 100 = fully
// see-through backdrop for VS Code vibrancy), and a decorative Backdrop effect.
// Replaces the old theme <select> + translucency toggle.

export const BACKDROPS = [
  { id: 'none', label: 'None' },
  { id: 'glow', label: 'Glow' },
  { id: 'wash', label: 'Wash' },
  { id: 'grid', label: 'Grid' },
  { id: 'dots', label: 'Dotted grid' },
  { id: 'hatch', label: 'Hatch' },
  { id: 'grain', label: 'Grain' },
  { id: 'aurora', label: 'Aurora' },
];

// A swatch that reflects the theme for real: its surface tone (--bg) diagonally
// split with its accent (--link), plus its panel color as a thin ring — so the
// three themes read distinctly instead of three near-identical blue dots.
function swatchStyle(id) {
  const v = (THEMES[id] || {}).vars || {};
  const bg = v['--bg'] || '#000';
  const link = v['--link'] || '#58a6ff';
  const panel = v['--panel'] || bg;
  return {
    backgroundImage: `linear-gradient(135deg, ${bg} 0 55%, ${link} 55% 100%)`,
    borderColor: panel,
  };
}

// Monotone palette glyph (lucide). Single color via currentColor so it inherits
// the button's themed text color.
function PaletteIcon() {
  return (
    <svg className="appearance-ico" viewBox="0 0 24 24" width="16" height="16"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="13.5" cy="6.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r=".7" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

export default function AppearanceMenu({ theme, onTheme, transparency, onTransparency, backdrop, onBackdrop, backdropOpacity, onBackdropOpacity }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="appearance" data-taskforge-ui ref={ref}>
      <button className={`appearance-btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)}
        title="Appearance — palette, transparency, backdrop" aria-label="Appearance">
        <PaletteIcon />
      </button>

      {open && (
        <div className="appearance-pop">
          <div className="ap-label">Palette</div>
          {THEME_LIST.map((t) => (
            <button key={t.id} className={`ap-row ${theme === t.id ? 'active' : ''}`} onClick={() => onTheme(t.id)}>
              <span className="ap-swatch" style={swatchStyle(t.id)} />
              <span className="ap-row-name">{t.label}</span>
              {theme === t.id && <span className="ap-check">✓</span>}
            </button>
          ))}

          <div className="ap-divider" />

          <div className="ap-label">Transparency</div>
          <div className="ap-slider-row">
            <input type="range" min="0" max="100" step="5" value={transparency}
              onChange={(e) => onTransparency(Number(e.target.value))} />
            <span className="ap-slider-val">{transparency}%</span>
          </div>
          <div className="ap-hint">Lets a VS Code vibrancy blur (and the backdrop) show through. Panels stay solid.</div>

          <div className="ap-divider" />

          <div className="ap-label">Backdrop</div>
          {BACKDROPS.map((b) => (
            <button key={b.id} className={`ap-row ${backdrop === b.id ? 'active' : ''}`} onClick={() => onBackdrop(b.id)}>
              <span className={`ap-fx-dot fx-dot-${b.id}`} />
              <span className="ap-row-name">{b.label}</span>
              {backdrop === b.id && <span className="ap-check">✓</span>}
            </button>
          ))}
          <div className={`ap-slider-row ${backdrop === 'none' ? 'ap-disabled' : ''}`}>
            <span className="ap-slider-lead">Intensity</span>
            <input type="range" min="0" max="100" step="5" value={backdropOpacity}
              disabled={backdrop === 'none'}
              onChange={(e) => onBackdropOpacity(Number(e.target.value))} />
            <span className="ap-slider-val">{backdropOpacity}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
