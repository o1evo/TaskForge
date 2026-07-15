import React, { useEffect, useRef, useState } from 'react';
import { listReviews, getReview, postMessage, deleteMessage, deleteThread, postAnchor, setAnchorState, deleteAnchor, setPageMeta, listTags, saveTag, deleteTag, setPrimaryParticipant, deleteParticipant } from './api.js';
import { openChat, requestRespond, inHost, setSendContext, requestClipboard, runVscodeCommand } from './bridge.js';
import HunkView from './components/HunkView.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import TasksManager from './components/TasksManager.jsx';
import FindBar from './components/FindBar.jsx';
import FileTree, { fileDomId } from './components/FileTree.jsx';
import ThreadsBubble from './components/ThreadsBubble.jsx';
import Thread from './components/Thread.jsx';
import ChatLinks from './components/ChatLinks.jsx';
import PageRuntime, { buildTaskForge } from './components/PageRuntime.jsx';
import Markdown from './components/Markdown.jsx';
import CopyButton from './components/CopyButton.jsx';
import AppearanceMenu from './components/AppearanceMenu.jsx';
import { applyTheme, pagePalette, readSavedTheme } from './themes.js';

// Saved transparency (0 = solid, 100 = fully see-through). Migrates the old
// on/off `taskforge.translucent` flag to a sensible slider value.
function readTransparency() {
  try {
    const v = localStorage.getItem('taskforge.transparency');
    if (v != null) return Math.max(0, Math.min(100, Number(v) || 0));
    return localStorage.getItem('taskforge.translucent') === 'on' ? 70 : 0;
  } catch { return 0; }
}
function readBackdrop() {
  try { return localStorage.getItem('taskforge.backdrop') || 'none'; } catch { return 'none'; }
}
function readBackdropOpacity() {
  try {
    const v = localStorage.getItem('taskforge.backdropOpacity');
    return v == null ? 100 : Math.max(0, Math.min(100, Number(v) || 0));
  } catch { return 100; }
}
// Push the transparency amount onto the backdrop's alpha (a CSS var body reads).
function applyTransparency(t) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--bg-opacity', `${100 - t}%`);
}

// Apply the saved theme + transparency before React mounts (no flash of the
// default palette / a solid backdrop for a vibrancy user).
applyTheme(readSavedTheme());
applyTransparency(readTransparency());

const POLL_MS = 3000;
const CURRENT_KEY = 'taskforge.currentReview';

export default function App() {
  const [reviews, setReviews] = useState([]);
  const [tags, setTags] = useState([]); // workspace-wide tag catalog [{ name, color }]
  const [currentId, setCurrentId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(null); // null → default per task (Log if it has a page)
  const [pendingJump, setPendingJump] = useState(null); // DOM id to scroll to after a tab switch
  const [paletteOpen, setPaletteOpen] = useState(false); // ⌘K task switcher
  const [manageOpen, setManageOpen] = useState(false); // "manage tasks" modal
  const [findOpen, setFindOpen] = useState(false); // ⌘F in-page find bar
  const [project, setProject] = useState(() => { // top-level project scope for the ⌘K switcher (null = All)
    try { return localStorage.getItem('taskforge.currentProject') || null; } catch { return null; }
  });
  const [theme, setTheme] = useState(readSavedTheme); // color theme (chrome + pages)
  const [transparency, setTransparency] = useState(readTransparency); // 0 solid → 100 see-through
  const [backdrop, setBackdrop] = useState(readBackdrop); // decorative backdrop effect id
  const [backdropOpacity, setBackdropOpacity] = useState(readBackdropOpacity); // effect intensity 0–100
  // When on (and we're hosted by the extension), posting a question asks the host
  // to trigger an AI reply — no need to switch to the chat and say "check threads".
  const [autoRespond, setAutoRespond] = useState(() => {
    try { return localStorage.getItem('taskforge.autoRespond') !== 'off'; } catch { return true; }
  });
  const mtimeRef = useRef(null);

  // Cross-tab navigation handed to the Log page via taskforge.onNavigate: switch tabs
  // and (optionally) remember a DOM id for the target tab to scroll to once mounted.
  function goToView(targetView, domId) {
    setView(targetView || 'review');
    if (domId) setPendingJump(domId);
  }

  // ⌘K / Ctrl+K toggles the task-switcher palette from anywhere. F5 hard-reloads
  // the whole app — inside the VS Code webview the iframe swallows the default
  // browser reload, so we reload explicitly to recover from a wedged view.
  useEffect(() => {
    function onKey(e) {
      // Webview key workarounds — only inside the extension host, where the
      // cross-origin iframe swallows ⌘V and VS Code keybindings.
      if (inHost()) {
        // Bridged paste: ⌘V/Ctrl+V into a text field. The webview blocks native
        // paste, so read the clipboard via the host and insert at the caret
        // (execCommand fires the input event so the controlled textarea updates).
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) {
          const el = document.activeElement;
          const editable = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
          if (editable) {
            e.preventDefault();
            requestClipboard().then((t) => { if (t) document.execCommand('insertText', false, t); });
            return;
          }
        }
        // Forward VS Code shortcuts the focused webview would otherwise eat.
        if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
          e.preventDefault();
          runVscodeCommand(e.shiftKey ? 'workbench.action.previousEditor' : 'workbench.action.nextEditor');
          return;
        }
        if (e.metaKey && e.shiftKey && (e.key === 'w' || e.key === 'W')) {
          e.preventDefault();
          runVscodeCommand('workbench.action.closeWindow');
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === 'F5' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.location.reload();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        // ⌘F: the editor's native find can't reach into our iframe, so open the
        // in-page find bar instead.
        e.preventDefault();
        setFindOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        // Copy the current text selection. Inside the VS Code webview iframe the
        // default ⌘C/Ctrl+C doesn't reach the clipboard (cross-origin permissions
        // policy), so when there's a real selection — and we're not in an editable
        // field, which handles its own copy — we copy it ourselves. No selection →
        // leave the default alone.
        const el = document.activeElement;
        const editable = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (editable) return;
        const text = (window.getSelection()?.toString()) || '';
        if (!text) return;
        e.preventDefault();
        // Browser / permitted contexts: the async Clipboard API.
        try { if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(() => {}); } catch { /* ignore */ }
        // VS Code webview: hand the text to the extension host, which always has
        // clipboard access. The webview shell forwards this to vscode.env.clipboard.
        try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'taskforge-clipboard-write', text }, '*'); } catch { /* ignore */ }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Apply + persist the theme whenever it changes (chrome re-themes via CSS vars;
  // pages re-theme via taskforge.theme on their next render).
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem('taskforge.theme', theme); } catch { /* ignore */ }
  }, [theme]);

  // Transparency thins the app backdrop so a VS Code vibrancy blur (and the
  // chosen backdrop effect) show through; panels stay opaque so content stays
  // readable. Backdrop just picks the decorative effect layer rendered below.
  useEffect(() => {
    applyTransparency(transparency);
    try { localStorage.setItem('taskforge.transparency', String(transparency)); } catch { /* ignore */ }
  }, [transparency]);
  useEffect(() => {
    try { localStorage.setItem('taskforge.backdrop', backdrop); } catch { /* ignore */ }
  }, [backdrop]);
  useEffect(() => {
    try { localStorage.setItem('taskforge.backdropOpacity', String(backdropOpacity)); } catch { /* ignore */ }
  }, [backdropOpacity]);

  // Load the list of reviews once. Restore the most-recently-selected task
  // for this client (localStorage is per-browser), falling back to the first.
  useEffect(() => {
    listReviews()
      .then((list) => {
        setReviews(list);
        if (list.length && !currentId) {
          let saved = null;
          try { saved = localStorage.getItem(CURRENT_KEY); } catch {}
          const restored = saved && list.some((r) => r.id === saved) ? saved : list[0].id;
          setCurrentId(restored);
        }
      })
      .catch((e) => setError(e.message));
    listTags().then(setTags).catch(() => { /* catalog optional */ });
  }, []);

  // Switch tasks and remember the choice for this client.
  // Re-fetch the reviews list (e.g. after a metadata change) so star/hide/name/project
  // changes show immediately without a full reload.
  async function refreshReviews() {
    try { setReviews(await listReviews()); } catch { /* keep the stale list */ }
  }
  async function updatePageMeta(id, p) {
    await setPageMeta(id, p);
    await refreshReviews();
  }
  // Persist a manual ordering for a set of pages (drag-to-reorder in the manager),
  // then refresh once rather than per-row.
  async function reorderPages(items) {
    await Promise.all(items.map(({ id, order }) => setPageMeta(id, { order })));
    await refreshReviews();
  }
  // Tag catalog mutations. A rename/delete cascades to page tags server-side, so we
  // refresh the reviews too. Errors (e.g. duplicate name) surface in the banner.
  async function upsertTag(spec) {
    try { setTags(await saveTag(spec)); await refreshReviews(); }
    catch (e) { setError(e.message); }
  }
  async function removeTag(name) {
    try { setTags(await deleteTag(name)); await refreshReviews(); }
    catch (e) { setError(e.message); }
  }

  function selectReview(id) {
    setCurrentId(id);
    try { localStorage.setItem(CURRENT_KEY, id); } catch {}
  }

  // Persisted project scope for the ⌘K task switcher. null → All.
  function selectProject(p) {
    setProject(p);
    try { if (p) localStorage.setItem('taskforge.currentProject', p); else localStorage.removeItem('taskforge.currentProject'); } catch { /* ignore */ }
  }
  // Drop a stale scope (project renamed/deleted / no task carries it) so the
  // switcher can't get stuck showing an empty list.
  useEffect(() => {
    if (project && reviews.length && !reviews.some((r) => !r.hidden && r.project === project)) selectProject(null);
  }, [reviews, project]);

  // Poll the selected review; only swap state when the file actually changed.
  useEffect(() => {
    if (!currentId) return;
    let alive = true;
    mtimeRef.current = null;
    setView(null); // reset to per-task default when switching tasks

    async function tick() {
      try {
        const next = await getReview(currentId);
        if (!alive) return;
        if (!next) {
          setError('review not found');
          return;
        }
        setError(null);
        if (next._mtime !== mtimeRef.current) {
          mtimeRef.current = next._mtime;
          setData(next);
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
    }

    tick();
    const h = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [currentId]);

  // Publish the current page's primary chat + whether it's open, so a Thread's
  // Send ▾ menu can grey out "Headless — same chat" when that session is live.
  useEffect(() => {
    const parts = (data && data.participants) || [];
    const primary = parts.find((p) => p.role === 'primary') || null;
    setSendContext({
      hasPrimary: !!primary,
      primaryOpen: !!(primary && primary.open),
      primarySessionId: (primary && primary.sessionId) || null,
    });
  }, [data]);

  // Force an immediate refresh rather than waiting for the next poll.
  async function refresh() {
    const next = await getReview(currentId);
    if (next) {
      mtimeRef.current = next._mtime;
      setData(next);
    }
  }

  async function send(target, text) {
    const posted = await postMessage(currentId, target, text);
    // Auto-ask the reviewer: hand the freshly-posted question to the extension
    // host, which either reopens the page's primary (root) chat with the prompt
    // staged, or answers headlessly — per the mode chosen in the Send ▾ menu
    // (persisted in localStorage), falling back to the taskforge.respondMode
    // setting. No-op in a plain browser or when auto-ask is off.
    const host = inHost();
    const primary = (data?.participants || []).find((p) => p.role === 'primary') || null;
    // The Send ▾ method picker is hidden for now, so auto-ask always uses
    // "open chat (paste)" (deeplink-root). Re-enable the picker in Thread.jsx to
    // restore per-send mode selection from localStorage.
    const mode = 'deeplink-root';
    if (autoRespond && host) {
      requestRespond({ id: currentId, target, text, primary, mode, authorMsgId: posted && posted.id });
    }
    await refresh();
  }

  async function removeMessage(target, messageId) {
    await deleteMessage(currentId, target, messageId);
    await refresh();
  }

  async function removeThread(target) {
    await deleteThread(currentId, target);
    await refresh();
  }

  async function createAnchor(anchor) {
    await postAnchor(currentId, anchor);
    await refresh();
  }

  async function changeAnchorState(key, state) {
    await setAnchorState(currentId, key, state);
    await refresh();
  }

  async function removeAnchor(key) {
    await deleteAnchor(currentId, key);
    await refresh();
  }

  // Reopen a linked AI chat (feature: "link chats to the page"). For Claude this
  // deep-links into the VS Code chat panel; other tools resolve to a configured
  // resume command host-side.
  function openParticipant(p) {
    openChat({ tool: p.tool, sessionId: p.sessionId, cwd: p.cwd || null });
  }
  async function makePrimary(p) {
    try { await setPrimaryParticipant(currentId, p.tool, p.sessionId); await refresh(); }
    catch (e) { setError(e.message); }
  }
  async function unlinkParticipant(p) {
    try { await deleteParticipant(currentId, p.tool, p.sessionId); await refresh(); }
    catch (e) { setError(e.message); }
  }

  function toggleAutoRespond() {
    setAutoRespond((v) => {
      const next = !v;
      try { localStorage.setItem('taskforge.autoRespond', next ? 'on' : 'off'); } catch { /* ignore */ }
      return next;
    });
  }

  if (error && !data) return <div className="app"><Banner error={error} /></div>;
  if (!currentId) return <div className="app"><Empty /></div>;
  if (!data) return <div className="app"><div className="loading">Loading…</div></div>;

  const { review, hunks, threads } = data;
  const byFile = groupByFile(hunks);
  const totalPending = countPending(threads);
  const hasPage = !!data._page;
  const activeView = view || (hasPage ? 'log' : 'review');
  const curMeta = reviews.find((r) => r.id === currentId) || {};

  return (
    <div className="app">
      <div className={`tf-backdrop fx-${backdrop}`} aria-hidden="true" data-taskforge-ui
        style={{ opacity: backdropOpacity / 100 }} />
      <header className="app-header">
        <div className="header-left">
          <div className="brand">TaskForge</div>
          <h1>{curMeta.name || review.title}</h1>
          <div className="review-meta">
            <code>{review.base} → {review.head}</code>
            {review.repo && <span className="repo">{review.repo}</span>}
          </div>
        </div>
        <div className="header-right">
          {reviews.length > 0 && (
            <div className="task-switch-wrap">
              <button className="task-switch" onClick={() => setPaletteOpen(true)}
                title={project ? `Switch task (⌘K) — scoped to project “${project}”` : 'Switch task (⌘K)'}>
                {curMeta.starred && <span className="task-switch-star">★</span>}
                <span className="task-switch-name">{curMeta.name || review.title}</span>
                {project && <span className="task-switch-proj" title={`Picker scoped to “${project}”`}>⛃ {project}</span>}
                <kbd className="task-switch-kbd">⌘K</kbd>
              </button>
              <button className="task-manage-btn" onClick={() => setManageOpen(true)} title="Manage tasks">⚙</button>
            </div>
          )}
          <AppearanceMenu theme={theme} onTheme={setTheme}
            transparency={transparency} onTransparency={setTransparency}
            backdrop={backdrop} onBackdrop={setBackdrop}
            backdropOpacity={backdropOpacity} onBackdropOpacity={setBackdropOpacity} />
          <ChatLinks participants={data.participants || []} onOpen={openParticipant}
            onSetPrimary={makePrimary} onUnlink={unlinkParticipant} />
          {inHost() && (
            <button
              className={`autorespond-toggle ${autoRespond ? 'on' : 'off'}`}
              onClick={toggleAutoRespond}
              title={autoRespond
                ? 'Auto-ask the reviewer when you post a question (click to turn off)'
                : 'Auto-ask is off — you post, then tell the chat to check threads (click to turn on)'}
            >
              {autoRespond ? '⚡ auto-ask on' : 'auto-ask off'}
            </button>
          )}
          <span className="poll-dot" title={`polling every ${POLL_MS / 1000}s`}>● live</span>
          {totalPending > 0 && <span className="header-pending">{totalPending} awaiting reviewer</span>}
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeView === 'log' ? 'active' : ''}`}
          onClick={() => setView('log')}
        >
          Log
        </button>
        <button
          className={`tab ${activeView === 'review' ? 'active' : ''}`}
          onClick={() => setView('review')}
        >
          Code Review
          {totalPending > 0 && <span className="tab-badge">{totalPending}</span>}
        </button>
        <button
          className={`tab ${activeView === 'qa' ? 'active' : ''}`}
          onClick={() => setView('qa')}
        >
          QA Plan
        </button>
      </nav>

      {error && <Banner error={error} />}

      {activeView === 'log' && (
        hasPage ? (
          <>
            <PageRuntime
              source={data._page.source}
              taskforge={buildTaskForge({
                id: currentId,
                data,
                onSend: send,
                onDelete: removeMessage,
                onAnchor: createAnchor,
                onAnchorState: changeAnchorState,
                onAnchorDelete: removeAnchor,
                onNavigate: goToView,
                theme: pagePalette(theme),
              })}
            />
            <ThreadsBubble scope="log" hunks={hunks} threads={threads} anchors={review.anchors || {}}
              onSend={send} onDelete={removeMessage} onDeleteAnchor={removeAnchor} onSetAnchorState={changeAnchorState} />
          </>
        ) : (
          <NoPage id={currentId} />
        )
      )}

      {activeView === 'review' && (
        <ReviewView review={review} byFile={byFile} threads={threads} hunks={hunks} onSend={send} onDelete={removeMessage} onDeleteThread={removeThread}
          onDeleteAnchor={removeAnchor} onSetAnchorState={changeAnchorState}
          jumpTarget={pendingJump} onJumped={() => setPendingJump(null)} />
      )}

      {activeView === 'qa' && <QaView id={currentId} qa={data._qa} />}

      <footer className="app-footer">
        Local file-bridge · <code>work/{review.id}/</code> ·
        Log page <code>Page.jsx</code> · review <code>thread.json</code> ·
        protocol in <code>CLAUDE.md</code>
      </footer>

      {findOpen && <FindBar onClose={() => setFindOpen(false)} />}
      {paletteOpen && (
        <CommandPalette reviews={reviews} tags={tags} currentId={currentId} onSelect={selectReview}
          project={project} onProject={selectProject}
          onClose={() => setPaletteOpen(false)} onManage={() => setManageOpen(true)} />
      )}
      {manageOpen && (
        <TasksManager reviews={reviews} tags={tags} currentId={currentId} onSelect={selectReview}
          onMeta={updatePageMeta} onReorder={reorderPages} onUpsertTag={upsertTag} onRemoveTag={removeTag}
          onClose={() => setManageOpen(false)} />
      )}
    </div>
  );
}

function ReviewView({ review, byFile, threads, hunks, onSend, onDelete, onDeleteThread, onDeleteAnchor, onSetAnchorState, jumpTarget, onJumped }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('taskforge.reviewSidebar') !== 'closed'; } catch { return true; }
  });
  function toggleSidebar() {
    setSidebarOpen((v) => {
      const next = !v;
      try { localStorage.setItem('taskforge.reviewSidebar', next ? 'open' : 'closed'); } catch {}
      return next;
    });
  }

  // Scroll a finding/hunk/line into view from the sidebar and flash it briefly.
  function jumpTo(domId) {
    const el = document.getElementById(domId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('jump-flash');
    setTimeout(() => el.classList.remove('jump-flash'), 1600);
  }

  // When the Log page jumps here (taskforge.openCode), the hunks have just mounted —
  // wait a frame so the target element exists, then scroll to it and clear the request.
  useEffect(() => {
    if (!jumpTarget) return;
    const raf = requestAnimationFrame(() => {
      jumpTo(jumpTarget);
      onJumped && onJumped();
    });
    return () => cancelAnimationFrame(raf);
  }, [jumpTarget]);

  // Changed files (diff order), each tagged with its finding count for the tree badge.
  const files = Object.entries(byFile).map(([file, fileHunks]) => ({
    path: file,
    findings: fileHunks.reduce((n, h) => n + ((h.annotations && h.annotations.length) || 0), 0),
  }));

  return (
    <div className={`review-layout ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      {sidebarOpen && <FileTree files={files} onJump={jumpTo} onClose={toggleSidebar} />}
      <div className="review-main">
        {!sidebarOpen && (
          <button className="rs-toggle" onClick={toggleSidebar} title="show the file tree">
            ☰ Files
          </button>
        )}
        <section className="general">
          <h2>General discussion</h2>
          <Thread messages={threads.general || []} target="general" onSend={(t) => onSend('general', t)}
            onDelete={(mid) => onDelete('general', mid)} />
        </section>

        {Object.entries(byFile).map(([file, fileHunks]) => (
          <section key={file} id={fileDomId(file)} className="file">
            <h2 className="file-name">{file}</h2>
            {fileHunks.map((h) => (
              <HunkView key={h.id} hunk={h} threads={threads} onSend={onSend} onDelete={onDelete} onDeleteThread={onDeleteThread} />
            ))}
          </section>
        ))}
      </div>

      <ThreadsBubble scope="review" hunks={hunks} threads={threads} anchors={review.anchors || {}}
        onJump={jumpTo} onSend={onSend} onDelete={onDelete}
        onDeleteThread={onDeleteThread} onDeleteAnchor={onDeleteAnchor} onSetAnchorState={onSetAnchorState} />
    </div>
  );
}

function QaView({ id, qa }) {
  if (!qa) {
    return (
      <div className="empty">
        <h1>No QA plan yet</h1>
        <p>
          Add a markdown QA plan at <code>work/{id}/qa-plan.md</code> — it renders here and can be
          copied out and handed to QA. Group tests by capability, tier them P0–P3, and give each a
          Do / Pass / Hits.
        </p>
      </div>
    );
  }
  return (
    <section className="qa">
      <div className="qa-toolbar">
        <span className="qa-file">work/{id}/qa-plan.md</span>
        <CopyButton text={qa.source} label="Copy markdown" />
      </div>
      <Markdown text={qa.source} />
    </section>
  );
}

function NoPage({ id }) {
  return (
    <div className="empty">
      <h1>No Log page yet</h1>
      <p>
        Ask Claude to build an interactive page for this task — it writes{' '}
        <code>work/{id}/Page.jsx</code> and it renders here live.
      </p>
    </div>
  );
}

function groupByFile(hunks) {
  const out = {};
  for (const h of hunks) {
    (out[h.file] = out[h.file] || []).push(h);
  }
  return out;
}

function countPending(threads) {
  let n = 0;
  for (const msgs of Object.values(threads || {})) {
    n += msgs.filter((m) => m.role === 'author' && !m.answered).length;
  }
  return n;
}

function Banner({ error }) {
  return <div className="banner-error">⚠ {error}</div>;
}

function Empty() {
  return (
    <div className="empty">
      <h1>No reviews yet</h1>
      <p>Import one with:</p>
      <pre>node bin/import.mjs --repo &lt;path&gt; --base main --head HEAD --title "…"</pre>
    </div>
  );
}
