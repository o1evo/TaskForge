#!/usr/bin/env node
// relay-sync-copilot.mjs — after a Relay run opens a PR, wait for GitHub Copilot's
// review and sync its line-anchored findings into the WCC review as hunk
// annotations. Deterministic (gh + WCC HTTP API, no LLM). Spawned detached by the
// launcher on a completed+PR run, or run by hand against an existing PR.
//
// Lazy: if Copilot leaves NO line-anchored findings, WCC is left untouched.
//
// Usage:
//   node bin/relay-sync-copilot.mjs --pr <n> --story <id> --repo <f2-path> \
//        [--title "..."] [--base main] [--branch <ref>] \
//        [--once] [--timeout-min 20] [--interval-sec 30] [--wcc-url http://wcc.test:7777]

import { spawnSync } from 'node:child_process';
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // WCC repo root
const LOG_DIR = join(ROOT, '.wcc');
const COPILOT_LOGIN = 'copilot-pull-request-reviewer[bot]';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function die(msg) { console.error(`relay-sync: ${msg}`); process.exit(1); }
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pr = args.pr;
  const story = args.story;
  const repo = args.repo && resolve(args.repo);
  if (!pr || !story || !repo) {
    die('Usage: --pr <n> --story <id> --repo <f2-path> [--title][--base][--branch][--once][--timeout-min N]');
  }
  const wccUrl = (args['wcc-url'] || 'http://wcc.test:7777').replace(/\/$/, '');
  // GitHub authors the *review* as `copilot-pull-request-reviewer[bot]` but the
  // individual line *comments* as `Copilot` — so match Copilot on either login.
  const copilotLoginExact = args['copilot-login'] || null;
  const isCopilot = (login) => (copilotLoginExact ? login === copilotLoginExact : /copilot/i.test(login || ''));
  const timeoutMin = Number(args['timeout-min'] || 20);
  const intervalSec = Number(args['interval-sec'] || 30);
  const logFile = join(LOG_DIR, `relay-sync-${story}.log`);

  const home = process.env.HOME || '';
  const env = {
    ...process.env,
    PATH: [
      dirname(process.execPath), `${home}/.local/bin`,
      '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
      process.env.PATH || '',
    ].filter(Boolean).join(':'),
  };

  function log(m) {
    const line = `${new Date().toISOString()} ${m}\n`;
    process.stdout.write(line);
    try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(logFile, line); } catch { /* best effort */ }
  }

  // gh api -> parsed JSON (cwd = repo so gh resolves the remote; env gives PATH).
  function gh(apiPath) {
    const r = spawnSync('gh', ['api', apiPath], { cwd: repo, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`gh api ${apiPath} failed: ${(r.stderr || '').trim().slice(0, 300)}`);
    return JSON.parse(r.stdout || 'null');
  }
  function ghSlug() {
    const r = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: repo, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`gh repo view failed: ${(r.stderr || '').trim()}`);
    return r.stdout.trim();
  }

  const slug = ghSlug();
  const meta = gh(`repos/${slug}/pulls/${pr}`);
  const branch = args.branch || meta.head?.ref;
  const base = args.base || meta.base?.ref || 'main';
  const title = args.title ? String(args.title) : (meta.title || story);
  log(`sync start pr=#${pr} repo=${slug} story=${story} branch=${branch} base=${base}`);

  // 1) Wait for Copilot's review to land.
  const deadline = Date.now() + timeoutMin * 60 * 1000;
  for (;;) {
    let reviewed = false;
    try {
      const reviews = gh(`repos/${slug}/pulls/${pr}/reviews`) || [];
      reviewed = reviews.some((rv) => rv.user && isCopilot(rv.user.login));
    } catch (e) { log(`poll error (will retry): ${e.message}`); }
    if (reviewed) { log('Copilot review present.'); break; }
    if (args.once) { log('Copilot review not present yet (--once) — nothing to sync.'); process.exit(0); }
    if (Date.now() > deadline) { log(`timed out after ${timeoutMin}m waiting for Copilot — nothing synced.`); process.exit(0); }
    log(`waiting for Copilot… (${Math.round((deadline - Date.now()) / 1000)}s left)`);
    sleepSync(intervalSec * 1000);
  }

  // 2) Collect Copilot's line-anchored findings (lazy: bail if none).
  const comments = (gh(`repos/${slug}/pulls/${pr}/comments`) || [])
    .filter((c) => c.user && isCopilot(c.user.login));
  // Copilot often leaves a review SUMMARY (review.body) with no inline comments —
  // capture it too, so a summary-only review still shows up in WCC.
  const summaryReviews = (gh(`repos/${slug}/pulls/${pr}/reviews`) || [])
    .filter((rv) => rv.user && isCopilot(rv.user.login) && String(rv.body || '').trim());
  const summary = summaryReviews.length ? String(summaryReviews[summaryReviews.length - 1].body).trim() : '';
  log(`${comments.length} line-anchored finding(s); review summary: ${summary ? 'present' : 'none'}.`);
  if (comments.length === 0 && !summary) { log('No findings and no summary — leaving WCC untouched (lazy).'); process.exit(0); }

  // 3) Import the PR diff into WCC (create fresh, or refresh if the review exists).
  const reviewFile = join(ROOT, 'reviews', story, 'thread.json');
  const importBin = join(ROOT, 'bin', 'import.mjs');
  // Always import against the CURRENT PR's branch (explicit --head), so the diff
  // matches what Copilot reviewed even on a same-story re-run with a new branch.
  // --refresh (when the review already exists) honors the explicit refs and
  // preserves existing threads/annotations.
  const baseImport = [importBin, '--repo', repo, '--base', base, '--head', branch, '--id', story, '--title', title];
  const importArgs = existsSync(reviewFile) ? [...baseImport, '--refresh'] : baseImport;
  const imp = spawnSync(process.execPath, importArgs, { cwd: ROOT, env, encoding: 'utf8' });
  if (imp.status !== 0) die(`import failed: ${(imp.stderr || imp.stdout || '').slice(0, 500)}`);
  log(`imported PR diff into review ${story}`);

  // 4) Map each finding to a hunk and seed annotations.
  const review = await fetchJson(`${wccUrl}/api/review/${story}`);
  const hunks = review.hunks || [];

  const byHunk = new Map();
  const orphans = [];
  for (const c of comments) {
    const line = c.line ?? c.original_line ?? null;
    const h = hunkFor(hunks, c.path, line);
    if (!h) { orphans.push(c); continue; }
    const body = String(c.body || '').trim();
    const severity = /\b(bug|incorrect|wrong|crash|nil|null|security|leak|injection|race|undefined|missing)\b/i.test(body) ? 'high' : 'medium';
    const ann = { tag: 'copilot', severity, note: body };
    if (line != null) ann.line = line;
    if (!byHunk.has(h.id)) byHunk.set(h.id, []);
    byHunk.get(h.id).push(ann);
  }

  for (const [hunkId, anns] of byHunk) {
    await postJson(`${wccUrl}/api/review/${story}/annotations`, { target: hunkId, annotations: anns });
    log(`seeded ${anns.length} finding(s) on ${hunkId}`);
  }
  for (const c of orphans) {
    const where = `${c.path}${c.line ? ':' + c.line : ''}`;
    await postJson(`${wccUrl}/api/review/${story}/message`, { target: 'general', text: `**Copilot** (${where}): ${String(c.body || '').trim()}` });
    log(`finding off-diff (${where}) -> general thread`);
  }

  // Post Copilot's review summary to the general thread (once).
  if (summary) {
    const general = (review.threads && review.threads.general) || [];
    if (general.some((m) => String(m.text || '').includes('Copilot review summary'))) {
      log('Copilot review summary already present — skipping.');
    } else {
      await postJson(`${wccUrl}/api/review/${story}/message`, { target: 'general', text: `**Copilot review summary**\n\n${summary}` });
      log('posted Copilot review summary to the general thread.');
    }
  }

  log(`DONE — synced ${comments.length} finding(s)${summary ? ' + review summary' : ''} into WCC review "${story}". Open ${wccUrl} -> ${story} -> Code Review.`);
  process.exit(0);
}

// Find the hunk whose new-side line range contains `line` (small tolerance for
// context). Falls back to the first hunk of the file; null if the file isn't in
// the diff.
function hunkFor(hunks, path, line) {
  const fileHunks = hunks.filter((h) => h.file === path);
  if (!fileHunks.length) return null;
  if (line != null) {
    for (const h of fileHunks) {
      const r = newRange(h.range);
      if (r && line >= r[0] - 3 && line <= r[1] + 3) return h;
    }
  }
  return fileHunks[0];
}

function newRange(rangeStr) {
  const m = /\+(\d+)(?:,(\d+))?/.exec(rangeStr || '');
  if (!m) return null;
  const start = Number(m[1]);
  const count = m[2] ? Number(m[2]) : 1;
  return [start, start + Math.max(count, 1) - 1];
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}
async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${url} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
