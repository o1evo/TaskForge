#!/usr/bin/env node
// PostToolUse hook — auto-records the AI chat sessions that take part in a
// TaskForge page, so the app can link back to them ("chats that took part").
//
// It reads the hook JSON on stdin and, when the tool touched a page's files
// (work/<id>/Page.jsx | thread.json | qa-plan.md — via an Edit, or a Bash
// command such as the reviewer's answer.mjs), POSTs the session to the running
// TaskForge API's /participants endpoint. First session recorded on a page
// becomes its "primary" (root) — the context-bearing chat the reviewer reopens.
//
// Tool-agnostic by construction: the endpoint takes any { tool, sessionId }, so
// a Gemini/OpenAI/etc. integration only needs to POST the same shape. This hook
// is the Claude wiring.
//
// Contract: best-effort and SILENT. It never blocks, never fails the tool, and
// exits 0 no matter what (a hard 1.5s cap guards against a hung socket).
import { basename } from 'node:path';
import { request } from 'node:http';

const PORT = Number(process.env.TASKFORGE_PORT) || 7777;
const done = () => process.exit(0);
setTimeout(done, 1500); // never hang the tool pipeline

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => { try { run(JSON.parse(raw || '{}')); } catch { done(); } });

function run(p) {
  const sessionId = p.session_id
    || (p.transcript_path ? basename(String(p.transcript_path)).replace(/\.jsonl$/, '') : '');
  if (!sessionId) return done();
  const cwd = p.cwd || null;

  // 1) A direct edit/write of a page file → the id + a label from the filename.
  const file = p?.tool_input?.file_path || p?.tool_input?.filePath || '';
  let hit = /(?:^|\/)work\/([A-Za-z0-9][A-Za-z0-9-]*)\/(Page\.jsx|thread\.json|qa-plan\.md)$/i.exec(file);
  if (hit) {
    const kind = hit[2].toLowerCase();
    const label = kind.startsWith('page') ? 'builder' : kind.startsWith('qa') ? 'qa' : 'reviewer';
    return post(hit[1], { tool: 'claude', sessionId, cwd, label });
  }

  // 2) A Bash command that answers/edits a review (answer.mjs, or any work/<id>/ path).
  const cmd = p?.tool_input?.command || '';
  if (cmd) {
    const idm = /--id[= ]+["']?([A-Za-z0-9][A-Za-z0-9-]*)/.exec(cmd);
    if (idm && /answer\.mjs|list_pending|thread\.json/.test(cmd)) {
      return post(idm[1], { tool: 'claude', sessionId, cwd, label: 'reviewer' });
    }
    const wm = /(?:^|[\s"'])work\/([A-Za-z0-9][A-Za-z0-9-]*)\//.exec(cmd);
    if (wm) return post(wm[1], { tool: 'claude', sessionId, cwd, label: 'editor' });
  }
  done();
}

function post(id, body) {
  const data = JSON.stringify(body);
  const req = request(
    {
      host: '127.0.0.1', port: PORT, method: 'POST',
      path: `/api/review/${encodeURIComponent(id)}/participants`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    },
    (res) => { res.resume(); res.on('end', done); },
  );
  req.on('error', done); // server not running → nothing to record into
  req.end(data);
}
