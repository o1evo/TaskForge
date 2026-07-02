import React, { useMemo, useState } from 'react';

// A GitHub-style file tree for the Code Review tab sidebar. Derives a nested
// folder/file tree from the changed files in the diff; clicking a file scrolls
// its section into view (onJump(fileDomId(file))). Pure derivation from hunks —
// no writes. Replaces the old findings/comments index (that moved to the
// floating threads bubble).

// Stable DOM id for a file's <section> in the diff. Shared with App.jsx so the
// tree's jump target matches the rendered section id exactly.
export function fileDomId(path) {
  return 'file-' + String(path || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Language/tool logo per file, via devicon (CSS import lives in main.jsx). Match
// exact filenames first (Gemfile, Dockerfile…), then extension. Returns a devicon
// class or null → the caller falls back to a plain 📄.
const EXT_ICON = {
  rb: 'ruby-plain', erb: 'ruby-plain', rake: 'ruby-plain',
  cs: 'csharp-plain', csx: 'csharp-plain',
  jsx: 'react-original', tsx: 'react-original',
  js: 'javascript-plain', mjs: 'javascript-plain', cjs: 'javascript-plain',
  ts: 'typescript-plain',
  py: 'python-plain', go: 'go-original-wordmark',
  html: 'html5-plain', erb_html: 'html5-plain',
  css: 'css3-plain', scss: 'sass-original', sass: 'sass-original',
  sh: 'bash-plain', bash: 'bash-plain', zsh: 'bash-plain',
  md: 'markdown-original', markdown: 'markdown-original',
  json: 'json-plain', yml: 'yaml-plain', yaml: 'yaml-plain',
  java: 'java-plain', kt: 'kotlin-plain', swift: 'swift-plain',
  rs: 'rust-plain', php: 'php-plain',
};
const NAME_ICON = {
  'Gemfile': 'ruby-plain', 'Rakefile': 'ruby-plain', 'Gemfile.lock': 'ruby-plain',
  'Dockerfile': 'docker-plain', '.dockerignore': 'docker-plain',
  'package.json': 'nodejs-plain', 'package-lock.json': 'nodejs-plain',
};
function iconClass(name) {
  if (NAME_ICON[name]) return NAME_ICON[name];
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return EXT_ICON[ext] || null;
}

// Build a nested tree from "a/b/c.rb" paths. Folders hold children; files are
// leaves carrying their full path + a finding count for the badge.
function buildTree(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    const leaf = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: (node.path ? node.path + '/' : '') + part, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ name: leaf, path: f.path, findings: f.findings });
  }
  return collapse(root);
}

// Collapse single-child folder chains into one row ("a/b/c") the way GitHub does,
// so deep trees with no branching don't waste vertical space.
function collapse(node) {
  for (const [key, child] of node.dirs) {
    let c = child;
    while (c.files.length === 0 && c.dirs.size === 1) {
      const [, only] = [...c.dirs][0];
      c = { name: c.name + '/' + only.name, path: only.path, dirs: only.dirs, files: only.files };
    }
    collapse(c);
    node.dirs.set(key, c);
  }
  return node;
}

export default function FileTree({ files, onJump, onClose }) {
  // files: [{ path, findings }] from the diff, in diff order.
  const tree = useMemo(() => buildTree(files || []), [files]);
  const total = (files || []).length;

  return (
    <aside className="review-sidebar file-tree" data-taskforge-ui>
      {onClose && (
        <button className="rs-collapse" onClick={onClose} title="hide the file tree">⟨ hide</button>
      )}
      <div className="ft-head">
        <span>Files</span>
        <span className="ft-count">{total}</span>
      </div>
      {total === 0 && <div className="rs-empty">No files in this diff.</div>}
      <TreeLevel node={tree} depth={0} onJump={onJump} />
    </aside>
  );
}

function TreeLevel({ node, depth, onJump }) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {dirs.map((d) => <Folder key={d.path} node={d} depth={depth} onJump={onJump} />)}
      {files.map((f) => (
        <button key={f.path} className="ft-file" style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onJump(fileDomId(f.path))} title={f.path}>
          <FileIcon name={f.name} />
          <span className="ft-name">{f.name}</span>
          {f.findings > 0 && <span className="ft-badge" title={`${f.findings} finding(s)`}>{f.findings}</span>}
        </button>
      ))}
    </>
  );
}

// Language logo for a file, or a plain doc glyph when the type is unknown.
function FileIcon({ name }) {
  const cls = iconClass(name);
  if (!cls) return <span className="ft-icon">📄</span>;
  return <i className={`ft-icon devicon-${cls} colored`} />;
}

function Folder({ node, depth, onJump }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button className="ft-dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen((o) => !o)} title={node.path}>
        <span className="ft-caret">{open ? '▾' : '▸'}</span>
        <span className="ft-icon">{open ? '📂' : '📁'}</span>
        <span className="ft-name">{node.name}</span>
      </button>
      {open && <TreeLevel node={node} depth={depth + 1} onJump={onJump} />}
    </>
  );
}
