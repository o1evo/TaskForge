// The bridge between the app (which runs inside a cross-origin iframe when hosted
// by the VS Code extension) and the extension host. The app can't touch the
// clipboard, open a vscode:// URI, or spawn a process from inside the sandboxed
// iframe — so it postMessages the request up to the webview shell, which relays
// it to the extension host (see vscode-extension/extension.js). In a plain
// browser (no parent frame) these are best-effort no-ops.
//
// Message contract (app → shell → extension host):
//   taskforge-clipboard-write { text }                       → write clipboard
//   taskforge-open-chat       { tool, sessionId, cwd, prompt }→ reopen an AI chat
//   taskforge-respond         { id, target, text, primary }   → auto-ask the reviewer

// Shared send context so the (deeply-nested, prop-light) Thread component can
// decide whether "Headless — same chat" is usable without prop-drilling. App
// updates it each poll; Thread reads it when its Send ▾ menu opens. Read at
// interaction time, so no re-render subscription is needed.
let _sendCtx = { hasPrimary: false, primaryOpen: false, primarySessionId: null };
export function setSendContext(c) { _sendCtx = { ..._sendCtx, ...c }; }
export function getSendContext() { return _sendCtx; }

// True when we're embedded (an extension webview or any parent frame), so the
// host can actually action these messages. Browser-only tabs get graceful no-ops.
export function inHost() {
  try { return !!(window.parent && window.parent !== window); } catch { return false; }
}

function post(msg) {
  try { if (inHost()) window.parent.postMessage(msg, '*'); } catch { /* ignore */ }
}

// Copy text robustly: the async Clipboard API when the context allows it, and
// (belt-and-suspenders) hand it to the extension host too, which always can.
export async function copyText(text) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { /* fall through to the host relay */ }
  post({ type: 'taskforge-clipboard-write', text });
  return ok;
}

// ── paste bridge + shortcut forwarding ─────────────────────────────────────────
// The VS Code webview swallows ⌘V and most VS Code keybindings while the app is
// focused. We work around it: read the system clipboard through the extension
// host (always allowed), and forward a whitelisted set of VS Code commands.
const _clipPending = new Map();
let _clipSeq = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    const m = e && e.data;
    if (m && m.type === 'taskforge-clipboard-text' && m.reqId != null) {
      const resolve = _clipPending.get(m.reqId);
      if (resolve) { _clipPending.delete(m.reqId); resolve(typeof m.text === 'string' ? m.text : ''); }
    }
  });
}

// Read the clipboard. In the extension, round-trips through the host; in a plain
// browser, uses the native async Clipboard API. Resolves '' on failure/timeout.
export function requestClipboard() {
  if (!inHost()) {
    try { return (navigator.clipboard && navigator.clipboard.readText) ? navigator.clipboard.readText().catch(() => '') : Promise.resolve(''); }
    catch { return Promise.resolve(''); }
  }
  return new Promise((resolve) => {
    const reqId = ++_clipSeq;
    _clipPending.set(reqId, resolve);
    post({ type: 'taskforge-request-clipboard', reqId });
    setTimeout(() => { if (_clipPending.has(reqId)) { _clipPending.delete(reqId); resolve(''); } }, 2000);
  });
}

// Ask the host to run a VS Code command (whitelisted host-side).
export function runVscodeCommand(command) {
  post({ type: 'taskforge-vscode-command', command });
}

// Ask the host to reopen a linked AI chat. For Claude this becomes a
// vscode://anthropic.claude-code/open?session=… deep link (chat panel);
// other tools resolve to a configured resume command in a terminal.
export function openChat({ tool, sessionId, cwd, prompt } = {}) {
  post({ type: 'taskforge-open-chat', tool, sessionId, cwd, prompt: prompt || '' });
}

// Ask the host to trigger an AI reply to a freshly-posted question. `primary`
// is the page's root participant (or null). `mode` is a per-send override chosen
// from the Send ▾ menu ('deeplink-root' | 'headless-root' | 'headless-reviewer');
// omit to fall back to the taskforge.respondMode setting. `authorMsgId` lets a
// headless reply mark the exact question answered.
export function requestRespond({ id, target, text, primary, mode, authorMsgId }) {
  post({
    type: 'taskforge-respond', id, target, text,
    primary: primary || null, mode: mode || null, authorMsgId: authorMsgId || null,
  });
}
