#!/usr/bin/env node
// Link the CURRENT chat session to a TaskForge page — no hook, no approval, works
// from ANY repo. A running Claude session invokes this (directly, or via the
// taskforge-worklog / taskforge-review skills) to register itself as a participant
// so the app can reopen it later ("chats that took part in this page").
//
// It figures out the calling session's id by finding the newest transcript under
// the Claude project dir for the current cwd — the active session's .jsonl is the
// one being appended to right now. Override with --session if you know it.
//
// Usage (from the session you want to link):
//   node bin/link-chat.mjs --id <review-id> [--primary] [--label <l>]
//                          [--tool claude] [--session <id>] [--cwd <path>] [--port 7777]
//
// Tool-agnostic: pass --tool gemini / openai / … with an explicit --session.
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { request } from 'node:http';

const args = parse(process.argv.slice(2));
if (!args.id) die('Pass --id <review-id>.');
const port = Number(args.port) || Number(process.env.TASKFORGE_PORT) || 7777;
const tool = args.tool || 'claude';
const cwd = args.cwd || process.cwd();

const sessionId = args.session || process.env.CLAUDE_SESSION_ID || newestSession(cwd);
if (!sessionId) {
  die(`Could not detect the current session id for cwd ${cwd}. Pass --session <id> ` +
      `(the basename of your ~/.claude/projects/<dir>/<id>.jsonl transcript).`);
}

const body = { tool, sessionId, cwd, label: args.label || (args.primary ? 'builder' : undefined) };
if (args.primary) body.role = 'primary';

post(`/api/review/${encodeURIComponent(args.id)}/participants`, body)
  .then((list) => {
    const me = (Array.isArray(list) ? list : []).find((p) => p.tool === tool && p.sessionId === sessionId);
    console.log(`linked ${tool} session ${sessionId.slice(0, 8)}… to "${args.id}"` +
      (me ? ` (role: ${me.role}, ${list.length} chat${list.length === 1 ? '' : 's'} total)` : ''));
  })
  .catch((e) => die(e.message));

// Newest *.jsonl under the Claude project dir that maps to `dir`. Claude encodes
// the cwd by replacing every non-alphanumeric char with '-'.
function newestSession(dir) {
  const cfg = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const projDir = join(cfg, 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
  let files;
  try { files = readdirSync(projDir).filter((f) => f.endsWith('.jsonl')); }
  catch { return null; }
  let best = null, bestMs = -1;
  for (const f of files) {
    try { const ms = statSync(join(projDir, f)).mtimeMs; if (ms > bestMs) { bestMs = ms; best = f; } }
    catch { /* skip */ }
  }
  return best ? basename(best, '.jsonl') : null;
}

function post(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = request(
      { host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(JSON.parse(out)); } catch { resolve(null); } }
          else reject(new Error(`server ${res.statusCode}: ${out || 'no body'} (is TaskForge running on :${port}?)`));
        });
      },
    );
    req.on('error', (e) => reject(new Error(`${e.message} — is TaskForge running on :${port}?`)));
    req.end(data);
  });
}

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) o[k] = true;
    else { o[k] = v; i++; }
  }
  return o;
}
function die(m) { console.error('error: ' + m); process.exit(1); }
