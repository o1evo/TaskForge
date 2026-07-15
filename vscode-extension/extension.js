// TaskForge — VS Code extension.
//
// Renders TaskForge (a local Vite/React app on 127.0.0.1:<port>) inside a webview
// panel. When the server isn't up, the panel shows a Start button instead of a
// blank iframe. Starting reuses the same convention as bin/taskforge-mcp.mjs: the dev
// server is spawned DETACHED so it outlives this VS Code window, and its pid/log
// land in <root>/.taskforge — so the extension and the MCP control the same server.

const vscode = require('vscode');
const { spawn, execFile } = require('node:child_process');
const { createConnection } = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

// ── config ───────────────────────────────────────────────────────────────────

function cfg() {
  const c = vscode.workspace.getConfiguration('taskforge');
  return {
    rootPath: (c.get('rootPath') || '').trim(),
    port: Number(c.get('port')) || 7777,
    host: (c.get('host') || '127.0.0.1').trim() || '127.0.0.1',
  };
}

// The URL rendered in the webview. Host is configurable (e.g. an /etc/hosts
// alias); the probe below always uses loopback since that's where it binds.
function taskforgeUrl() {
  const { host, port } = cfg();
  return `http://${host}:${port}`;
}

// Locate the TaskForge repo: explicit config → an open workspace folder that looks
// like TaskForge → the extension's own parent (it ships inside the repo).
function resolveRoot() {
  const { rootPath } = cfg();
  if (rootPath && looksLikeTaskForge(rootPath)) return rootPath;
  for (const f of vscode.workspace.workspaceFolders || []) {
    if (looksLikeTaskForge(f.uri.fsPath)) return f.uri.fsPath;
  }
  const parent = path.resolve(__dirname, '..');
  if (looksLikeTaskForge(parent)) return parent;
  return rootPath || parent; // best effort
}

function looksLikeTaskForge(dir) {
  try {
    return fs.existsSync(path.join(dir, 'vite.config.mjs')) &&
           fs.existsSync(path.join(dir, 'package.json'));
  } catch { return false; }
}

// ── server lifecycle (mirrors bin/taskforge-mcp.mjs) ────────────────────────────────

function isUp(timeoutMs = 600) {
  const { port } = cfg();
  return new Promise((res) => {
    const sock = createConnection({ host: '127.0.0.1', port });
    const done = (up) => { sock.destroy(); res(up); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

function listeningPids() {
  const { port } = cfg();
  return new Promise((res) => {
    if (process.platform === 'win32') {
      // Windows has no lsof: parse `netstat -ano` for LISTENING rows whose
      // local address ends in :<port>, collect the trailing PID column.
      execFile('cmd', ['/c', `netstat -ano -p tcp | findstr LISTENING`], (err, out) => {
        if (err || !out) return res([]);
        const pids = new Set();
        for (const line of String(out).split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5 && parts[1].endsWith(`:${port}`)) pids.add(parts[parts.length - 1]);
        }
        res([...pids]);
      });
    } else {
      execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], (err, out) => {
        if (err || !out) return res([]);
        res(String(out).split('\n').map((s) => s.trim()).filter(Boolean));
      });
    }
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Spawn `npm run review` detached + unref'd so the server survives this window.
async function startServer() {
  if (await isUp()) return { started: false, alreadyRunning: true };
  const root = resolveRoot();
  if (!looksLikeTaskForge(root)) {
    throw new Error(`Could not find the TaskForge repo. Set "taskforge.rootPath" in settings (looked at: ${root}).`);
  }
  const stateDir = path.join(root, '.taskforge');
  fs.mkdirSync(stateDir, { recursive: true });
  const fd = fs.openSync(path.join(stateDir, 'server.log'), 'a');
  const { port } = cfg();
  const isWin = process.platform === 'win32';
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

  let child;
  if (isWin && fs.existsSync(viteBin)) {
    // Launch Vite as a single Node process. Going through `npm.cmd` in a shell
    // spawns cmd → npm → node, and that final node allocates its own console —
    // which Windows 11 surfaces as a Windows Terminal window even with
    // `windowsHide`/`detached`. Spawning node directly with `windowsHide`
    // (CREATE_NO_WINDOW) keeps it headless. ELECTRON_RUN_AS_NODE reuses VS
    // Code's bundled Node, so we don't depend on `node` being on PATH.
    child = spawn(process.execPath, [viteBin], {
      cwd: root,
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TASKFORGE_PORT: String(port) },
    });
  } else {
    // POSIX (or Windows without a local vite): `npm run review`. On Windows npm
    // is `npm.cmd`, which Node 18+ only launches via a shell.
    child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'review'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, TASKFORGE_PORT: String(port) },
      shell: isWin,
      windowsHide: true,
    });
  }
  child.unref();
  try { fs.writeFileSync(path.join(stateDir, 'server.pid'), String(child.pid)); } catch {}
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await delay(300);
    if (await isUp()) return { started: true };
  }
  throw new Error(`TaskForge did not come up on :${cfg().port} within 20s — check ${path.join(stateDir, 'server.log')}.`);
}

async function stopServer() {
  const pids = await listeningPids();
  for (const pid of pids) {
    try { process.kill(Number(pid), 'SIGTERM'); } catch {}
  }
  return { stopped: pids.length > 0, killed: pids };
}

async function restartServer() {
  await stopServer();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && (await isUp())) await delay(200);
  return startServer();
}

// ── AI chat linking + auto-respond ─────────────────────────────────────────────
//
// Two capabilities the sandboxed webview can't do itself, so it postMessages them
// up here (see the relay in runningHtml):
//   • open-chat — reopen a linked AI session. Claude gets a documented deep link
//     straight into the VS Code chat panel; other tools fall back to a resume
//     command in a terminal (taskforge.resumeCommand).
//   • respond   — a question was just posted; trigger an AI reply per
//     taskforge.respondMode (default: reopen the page's primary/root chat with the
//     prompt pre-filled, so it answers with full context and you press Enter).

// Claude Code deep link — resumes a specific session in the chat panel with the
// prompt box pre-filled. `session` must belong to the current workspace; if it
// isn't found Claude opens a fresh session (still with the prompt staged).
// Docs: https://code.claude.com/docs/en/vs-code (URI handler).
function claudeDeepLink({ sessionId, prompt } = {}) {
  const qs = [];
  if (sessionId) qs.push(`session=${encodeURIComponent(sessionId)}`);
  if (prompt) qs.push(`prompt=${encodeURIComponent(prompt)}`);
  return `vscode://anthropic.claude-code/open${qs.length ? '?' + qs.join('&') : ''}`;
}

function reviewerPrompt({ id, target, text }) {
  return [
    `A new question was posted in TaskForge on task "${id}", thread "${target}".`,
    `Please answer it in the review: use the taskforge-review skill (scripts/answer.mjs)`,
    `to append your reply to work/${id}/thread.json for thread "${target}".`,
    ``,
    `Question:`,
    text || '',
  ].join('\n');
}

// Open a linked chat. Claude → chat-panel deep link; anything else → a terminal
// running the configured resume command with ${sessionId}/${cwd}/${tool} filled in.
async function openChat({ tool, sessionId, cwd, prompt }) {
  if (!tool || tool === 'claude') {
    const uri = claudeDeepLink({ sessionId, prompt });
    await vscode.env.openExternal(vscode.Uri.parse(uri));
    return;
  }
  const tmpl = (vscode.workspace.getConfiguration('taskforge').get('resumeCommand') || 'claude --resume ${sessionId}').trim();
  const cmd = tmpl
    .replace(/\$\{sessionId\}/g, sessionId || '')
    .replace(/\$\{cwd\}/g, cwd || '')
    .replace(/\$\{tool\}/g, tool || '');
  const term = vscode.window.createTerminal({ name: `TaskForge: ${tool}`, cwd: cwd || undefined });
  term.show(true);
  term.sendText(cmd, true);
}

// Trigger an AI reply to a just-posted question. `primary` is the page's root
// participant (or null). `mode` (when sent) is a per-send override chosen from the
// Send ▾ menu; otherwise the taskforge.respondMode setting applies.
async function respond({ id, target, text, primary, mode, authorMsgId }) {
  mode = mode || vscode.workspace.getConfiguration('taskforge').get('respondMode') || 'deeplink-root';
  // Visible breadcrumb so it's obvious the extension received the send and which
  // method it's running (if you see NO breadcrumb on send, the extension host is
  // a stale build — do Developer: Reload Window, not just F5).
  vscode.window.setStatusBarMessage(`$(comment) TaskForge: auto-ask → ${mode}`, 6000);
  if (mode === 'off') return;
  const prompt = reviewerPrompt({ id, target, text });

  if (mode === 'deeplink-root') {
    // Always stage the prompt on the clipboard first. The Claude deep link CANNOT
    // inject a prompt into a session that's already open (it shows "Session is
    // already open — enter it manually"), and the root chat is usually the one
    // you're in. We can't detect that case or suppress that dialog, so the
    // clipboard makes the fallback a single paste (⌘V, Enter).
    try { await vscode.env.clipboard.writeText(prompt); } catch { /* best effort */ }
    // Reopen the root chat (full context) in the panel with the prompt staged.
    if (primary && (primary.tool === 'claude' || !primary.tool)) {
      await vscode.env.openExternal(vscode.Uri.parse(claudeDeepLink({ sessionId: primary.sessionId, prompt })));
    } else if (primary) {
      await openChat({ tool: primary.tool, sessionId: primary.sessionId, cwd: primary.cwd, prompt });
    } else {
      // No linked root yet — open a fresh Claude chat with the prompt pre-filled.
      await vscode.env.openExternal(vscode.Uri.parse(claudeDeepLink({ prompt })));
    }
    vscode.window.setStatusBarMessage(
      '$(comment) TaskForge: question sent to chat — if it says "already open", paste (⌘V) & Enter',
      6000,
    );
    return;
  }

  // Headless modes: the model GENERATES the answer text (no file/tool permissions
  // needed) and we write it into the thread via /reviewer-reply. 'headless-root'
  // resumes the page's root session so the answer has its full context (it appends
  // to that session's transcript); 'headless-reviewer' runs a fresh session and
  // relies on the context we inline into the prompt.
  const resumeSid = mode === 'headless-root' && primary ? primary.sessionId : null;
  const cwd = (primary && primary.cwd) || resolveRoot();
  await runRespondHeadless({ id, target, text, resumeSid, cwd, authorMsgId });
}

// Resolve the Claude CLI: explicit setting → common install locations → bare
// `claude` (relies on PATH). The bundled VS Code copy isn't exported to PATH.
function resolveClaudeCli() {
  const set = (vscode.workspace.getConfiguration('taskforge').get('claudeCliPath') || '').trim();
  if (set) return set;
  const home = process.env.HOME || '';
  for (const c of [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  return 'claude';
}

// Headless generate-then-write. Spawns `claude -p [--resume <sid>] <prompt>
// --output-format json`, extracts the generated text, and POSTs it as the
// reviewer reply. The prompt forbids tool use, so no permission prompts can stall
// a non-interactive run. Also records the session it used as a participant.
async function runRespondHeadless({ id, target, text, resumeSid, cwd, authorMsgId }) {
  const cli = resolveClaudeCli();
  const context = await buildThreadContext(id, target);
  const prompt = [
    `You are the TaskForge reviewer for task "${id}". Answer the newest question in thread "${target}".`,
    `Reply with ONLY the answer, as Markdown. Do NOT use any tools, do not run commands, do not edit files —`,
    `just produce the reply text; TaskForge will post it for you.`,
    context ? `\nThread so far:\n${context}` : '',
    `\nNewest question:\n${text}`,
  ].join('\n');

  const result = await new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (resumeSid) args.unshift('--resume', resumeSid);
    let child;
    try { child = spawn(cli, args, { cwd, env: process.env }); }
    catch (e) { vscode.window.showErrorMessage(`TaskForge auto-respond: could not launch "${cli}" — ${e.message}`); return resolve(null); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 180000);
    child.stdout && child.stdout.on('data', (d) => { out += d; });
    child.stderr && child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); vscode.window.showErrorMessage(`TaskForge auto-respond failed: ${e.message} (set taskforge.claudeCliPath?)`); resolve(null); });
    child.on('close', () => { clearTimeout(timer); resolve({ out, err }); });
  });
  if (!result) return;

  let answer = '', sid = '';
  try { const j = JSON.parse(result.out); answer = String(j.result || '').trim(); sid = j.session_id || ''; }
  catch { /* not JSON — fall through to the error path below */ }
  if (!answer) {
    vscode.window.showErrorMessage('TaskForge auto-respond: the model returned no answer (see Output). Falling back to none.');
    return;
  }
  try { await postApi(`/api/review/${encodeURIComponent(id)}/reviewer-reply`, { target, text: answer, answerMsgId }); }
  catch (e) { vscode.window.showErrorMessage(`TaskForge auto-respond: could not post the reply — ${e.message}`); return; }
  if (sid) postApi(`/api/review/${encodeURIComponent(id)}/participants`, { tool: 'claude', sessionId: sid, cwd, label: 'reviewer' }).catch(() => {});
  vscode.window.setStatusBarMessage('$(comment) TaskForge: reviewer answered', 4000);
}

// A compact transcript of a thread, to inline as context for the headless answer.
async function buildThreadContext(id, target) {
  try {
    const data = await getApi(`/api/review/${encodeURIComponent(id)}`);
    const msgs = (data && data.threads && data.threads[target]) || [];
    return msgs.slice(-12).map((m) => `${m.role}: ${String(m.text || '').slice(0, 800)}`).join('\n');
  } catch { return ''; }
}

// Minimal localhost JSON helpers against the running TaskForge server.
function apiReq(method, path, body) {
  const { port } = cfg();
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      { host: '127.0.0.1', port, path, method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(out ? JSON.parse(out) : null); } catch { resolve(null); } }
          else reject(new Error(`server ${res.statusCode}: ${out}`));
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function getApi(path) { return apiReq('GET', path, null); }
function postApi(path, body) { return apiReq('POST', path, body); }

// ── webview ───────────────────────────────────────────────────────────────────

// The editor panel renders the app (full width). The activity-bar icon is just a
// launcher: clicking it reveals a tiny view that immediately opens this panel and
// collapses the sidebar — so the icon behaves like an "open TaskForge in editor" button.
let panel = null;          // vscode.WebviewPanel | null
let pollTimer = null;
let lastUp = null;

function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }

function runningHtml(url) {
  // CSP must explicitly allow framing the TaskForge origin. default-src 'none' keeps
  // everything else locked down; the iframe gets its own permissions via sandbox.
  //
  // `allow` delegates Permissions-Policy features to the cross-origin (127.0.0.1)
  // iframe. clipboard-write defaults to `self` only, so without this the embedded
  // app — and ⌘C of a selection — can't write to the clipboard at all.
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; frame-src ${url}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  /* Transparent host so the app's backdrop reaches the editor group behind it —
     lets a VS Code vibrancy blur show through when the app's Translucent toggle
     is on. Harmless when it's off: the app paints a solid backdrop over this. */
  html, body { margin:0; padding:0; height:100%; width:100%; overflow:hidden; background:transparent; }
  iframe { border:0; width:100%; height:100%; display:block; }
</style></head>
<body>
  <iframe src="${escAttr(url)}"
    allow="clipboard-read ${url}; clipboard-write ${url}"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads">
  </iframe>
  <script>
    // Clipboard bridge: the embedded app can't write the clipboard from inside a
    // cross-origin iframe, so it postMessages the selected text up here and we
    // relay it to the extension host (vscode.env.clipboard), which always can.
    const vscode = acquireVsCodeApi();
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || typeof m.type !== 'string') return;
      if (m.type.indexOf('taskforge-') === 0) {
        // From the app iframe → relay up to the extension host.
        if (m.type === 'taskforge-clipboard-write' && typeof m.text === 'string') {
          vscode.postMessage({ type: 'clipboard-write', text: m.text });
        } else if (m.type === 'taskforge-open-chat') {
          vscode.postMessage({ type: 'open-chat', tool: m.tool, sessionId: m.sessionId, cwd: m.cwd, prompt: m.prompt });
        } else if (m.type === 'taskforge-respond') {
          vscode.postMessage({ type: 'respond', id: m.id, target: m.target, text: m.text, primary: m.primary, mode: m.mode, authorMsgId: m.authorMsgId });
        } else if (m.type === 'taskforge-request-clipboard') {
          vscode.postMessage({ type: 'request-clipboard', reqId: m.reqId });
        } else if (m.type === 'taskforge-vscode-command') {
          vscode.postMessage({ type: 'vscode-command', command: m.command });
        }
      } else if (m.type === 'clipboard-text') {
        // From the extension host → relay DOWN into the app iframe (paste bridge).
        const f = document.querySelector('iframe');
        if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'taskforge-clipboard-text', reqId: m.reqId, text: m.text }, '*');
      }
    });
  </script>
</body></html>`;
}

function downHtml(url, starting) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  html, body { margin:0; height:100%; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  body { display:flex; align-items:center; justify-content:center; background: var(--vscode-editor-background); }
  .card { text-align:center; max-width:420px; padding:1.5rem; }
  h1 { font-size:1.1rem; font-weight:600; margin:0 0 .4rem; }
  p { opacity:.75; margin:0 0 1.2rem; line-height:1.5; font-size:.85rem; word-break:break-all; }
  code { background: var(--vscode-textCodeBlock-background); padding:.1em .4em; border-radius:3px; }
  button {
    font-size:.9rem; padding:.55rem 1.2rem; border:0; border-radius:4px; cursor:pointer; margin:.2rem;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity:.6; cursor:default; }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .spin { display:inline-block; width:1em; height:1em; vertical-align:-.15em; margin-right:.5em;
    border:2px solid currentColor; border-right-color:transparent; border-radius:50%;
    animation: r .7s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
</style></head>
<body>
  <div class="card">
    <h1>TaskForge isn't running</h1>
    <p>Expected at <code>${escAttr(url)}</code>.</p>
    <button id="start" ${starting ? 'disabled' : ''}>
      ${starting ? '<span class="spin"></span>Starting…' : '▶ Start TaskForge'}
    </button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const btn = document.getElementById('start');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>Starting…';
      vscode.postMessage({ type: 'start' });
    });
  </script>
</body></html>`;
}

// Wire the panel webview to the Start button message.
function attach(webview) {
  webview.onDidReceiveMessage(async (msg) => {
    if (msg && msg.type === 'start') {
      try { await render(true); await startServer(); }
      catch (e) { vscode.window.showErrorMessage(`TaskForge: ${e.message}`); }
      await render(false);
    } else if (msg && msg.type === 'clipboard-write' && typeof msg.text === 'string') {
      // ⌘C relayed up from the embedded app — the extension host can always write.
      try { await vscode.env.clipboard.writeText(msg.text); } catch { /* best effort */ }
    } else if (msg && msg.type === 'open-chat') {
      try { await openChat(msg); }
      catch (e) { vscode.window.showErrorMessage(`TaskForge: could not open chat — ${e.message}`); }
    } else if (msg && msg.type === 'respond') {
      try { await respond(msg); }
      catch (e) { vscode.window.showErrorMessage(`TaskForge: auto-respond failed — ${e.message}`); }
    } else if (msg && msg.type === 'request-clipboard') {
      // Paste bridge: read the system clipboard (always works in the host) and
      // hand it back down to the app, which inserts it at the caret.
      let text = '';
      try { text = await vscode.env.clipboard.readText(); } catch { /* empty */ }
      try { webview.postMessage({ type: 'clipboard-text', reqId: msg.reqId, text }); } catch { /* gone */ }
    } else if (msg && msg.type === 'vscode-command' && typeof msg.command === 'string') {
      // Forward a whitelisted VS Code command the focused webview would otherwise swallow.
      const ALLOWED = new Set(['workbench.action.nextEditor', 'workbench.action.previousEditor', 'workbench.action.closeWindow']);
      if (ALLOWED.has(msg.command)) {
        try { await vscode.commands.executeCommand(msg.command); } catch { /* ignore */ }
      }
    }
  });
}

// Refresh the panel. `starting` paints the in-progress button state.
async function render(starting) {
  if (!panel) return;
  const up = await isUp();
  lastUp = up;
  const url = taskforgeUrl();
  panel.webview.html = up ? runningHtml(url) : downHtml(url, !!starting);
}

// Hard-reload the webview. Repainting the same HTML won't reload the iframe, so
// blank it first, then repaint with a cache-busting query so the embedded app
// reloads from scratch — the recovery path for a wedged view (F5).
async function reload() {
  if (!panel) { await openPanel(); return; }
  if (!(await isUp())) { await render(false); return; }
  const url = taskforgeUrl();
  const busted = url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now();
  panel.webview.html = '<!DOCTYPE html><html><body></body></html>';
  panel.webview.html = runningHtml(busted);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!panel) return stopPolling();
    const up = await isUp();
    if (up !== lastUp) await render(false); // reflect external start/stop
  }, 3000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function openPanel() {
  if (panel) { panel.reveal(vscode.ViewColumn.Active); return; }
  panel = vscode.window.createWebviewPanel('taskforge', 'TaskForge', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.iconPath = {
    light: vscode.Uri.file(path.join(__dirname, 'media', 'taskforge-tab-light.svg')),
    dark: vscode.Uri.file(path.join(__dirname, 'media', 'taskforge-tab-dark.svg')),
  };
  panel.onDidDispose(() => { panel = null; stopPolling(); });
  attach(panel.webview);
  await render(false);
  startPolling();
}

// The activity-bar view is a launcher only: as soon as it becomes visible
// (icon clicked), open the editor panel and collapse the sidebar, so the icon
// acts like an "open TaskForge in editor" button rather than hosting the app itself.
const sidebarProvider = {
  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-descriptionForeground);
  padding:1rem;font-size:.85rem;line-height:1.5}</style></head>
<body>Opening TaskForge in the editor…</body></html>`;
    const launch = () => {
      if (!webviewView.visible) return;
      openPanel();
      // Collapse the sidebar so the icon click reads as "open in editor".
      vscode.commands.executeCommand('workbench.action.closeSidebar');
    };
    webviewView.onDidChangeVisibility(launch);
    launch();
  },
};

// ── status bar ─────────────────────────────────────────────────────────────────

let statusItem = null;

async function refreshStatusBar() {
  if (!statusItem) return;
  const up = await isUp();
  statusItem.text = up ? '$(server) TaskForge' : '$(debug-disconnect) TaskForge';
  statusItem.tooltip = up ? `TaskForge running — ${taskforgeUrl()} (click to open)` : 'TaskForge stopped — click to open / start';
  statusItem.show();
}

// ── activation ───────────────────────────────────────────────────────────────

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = 'taskforge.open';
  context.subscriptions.push(statusItem);

  const sbTimer = setInterval(refreshStatusBar, 4000);
  context.subscriptions.push({ dispose: () => clearInterval(sbTimer) });
  refreshStatusBar();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('taskforge.sidebar', sidebarProvider),
    vscode.commands.registerCommand('taskforge.open', () => openPanel()),
    vscode.commands.registerCommand('taskforge.start', async () => {
      try {
        const r = await startServer();
        vscode.window.showInformationMessage(r.alreadyRunning ? 'TaskForge already running.' : 'TaskForge started.');
      } catch (e) { vscode.window.showErrorMessage(`TaskForge: ${e.message}`); }
      await refreshStatusBar();
      if (panel) await render(false);
    }),
    vscode.commands.registerCommand('taskforge.stop', async () => {
      const r = await stopServer();
      vscode.window.showInformationMessage(r.stopped ? `TaskForge stopped (pid ${r.killed.join(', ')}).` : 'TaskForge was not running.');
      await refreshStatusBar();
      if (panel) await render(false);
    }),
    vscode.commands.registerCommand('taskforge.restart', async () => {
      try { await restartServer(); vscode.window.showInformationMessage('TaskForge restarted.'); }
      catch (e) { vscode.window.showErrorMessage(`TaskForge: ${e.message}`); }
      await refreshStatusBar();
      if (panel) await render(false);
    }),
    vscode.commands.registerCommand('taskforge.openExternal', () => {
      vscode.env.openExternal(vscode.Uri.parse(taskforgeUrl()));
    }),
    vscode.commands.registerCommand('taskforge.refresh', () => reload()),
  );
}

function deactivate() { stopPolling(); }

module.exports = { activate, deactivate };
