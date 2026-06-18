#!/usr/bin/env node
// Relay launcher — runs ONE headless `claude --print` pass over a story, parses
// the structured outcome, and routes on status. No loop, no daemon: each pass is
// triggered by the WCC "Resume" button (POST /api/review/:id/run) or a CLI
// kickoff. The "loop" is human-paced — answer in WCC, click Resume, repeat.
//
// Usage:
//   node bin/relay-run.mjs --repo <f2-path> --story <id> --title "..."   # first run
//   node bin/relay-run.mjs --repo <f2-path> --story <id> --resume         # continue
//   node bin/relay-run.mjs --repo <f2-path> --story <id> --dry-run        # print, don't run
//
// See bin/relay-README.md.

import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync, existsSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // WCC repo root
const PROMPT_PATH = join(ROOT, 'bin', 'relay-prompt.md');
const LOG_DIR = join(ROOT, '.wcc');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function die(msg) {
  console.error(`relay: ${msg}`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo && resolve(args.repo);
  const story = args.story;
  if (!repo || !story) {
    die('Usage: relay-run.mjs --repo <f2-path> --story <id> [--resume] [--title "..."] [--dry-run]');
  }

  const mode = args.resume ? 'resume' : 'fresh';
  const wccUrl = args['wcc-url'] || 'http://wcc.test:7777';
  const model = args.model || 'claude-opus-4-8';
  const claudeBin = resolveClaude(args['claude-bin']);
  // Detached/background spawns (and the WCC /run endpoint) don't inherit the
  // interactive shell PATH, and spawnSync bypasses the shell — so give claude
  // (and the git/gh/node/bundle it shells out to) an explicit PATH covering the
  // usual install dirs plus rbenv shims (for RBENV_VERSION=2.6.10 specs).
  const home = process.env.HOME || '';
  const childEnv = {
    ...process.env,
    PATH: [
      dirname(process.execPath),
      `${home}/.local/bin`,
      '/opt/homebrew/bin', '/usr/local/bin',
      `${home}/.rbenv/shims`, `${home}/.rbenv/bin`,
      '/usr/bin', '/bin',
      process.env.PATH || '',
    ].filter(Boolean).join(':'),
  };
  const logFile = join(LOG_DIR, `relay-${story}.log`);

  function log(msg) {
    const line = `${new Date().toISOString()} ${msg}\n`;
    process.stdout.write(line);
    try {
      mkdirSync(LOG_DIR, { recursive: true });
      appendFileSync(logFile, line);
    } catch {
      /* logging is best-effort */
    }
  }

  // By default the WCC story page is created lazily — only when Claude needs to
  // checkpoint. `--page` forces it on this run regardless (operator wants the page).
  const wccDirective = args.page
    ? 'Create or refresh the WCC story page on THIS run regardless of whether you checkpoint (an operator explicitly requested it).'
    : 'Create the WCC story page when you post a checkpoint question OR write a QA plan (see "QA plan"). Skip WCC entirely only if the run reaches a clean PR with no checkpoint AND the story opts out of QA.';

  // Branch override: pass --branch to pin an exact branch name (e.g. to avoid a
  // collision with an orphaned remote branch from a prior run). Default lets the
  // model pick the slug, per f2 convention.
  const branchDirective = args.branch
    ? `\`${args.branch}\` — use exactly this name; do NOT invent your own slug (a prior branch for this task may exist remotely, so this distinct name avoids a push collision).`
    : 'feature/ai-<short>-CU-<taskid>, where <short> is a 1-3 word slug of the task (lowercase letters/digits/hyphens).';

  const prompt = readFileSync(PROMPT_PATH, 'utf8')
    .replaceAll('{{WCC_ROOT}}', ROOT)
    .replaceAll('{{REPO}}', repo)
    .replaceAll('{{REVIEW_ID}}', story)
    .replaceAll('{{WCC_URL}}', wccUrl)
    .replaceAll('{{MODE}}', mode)
    .replaceAll('{{WCC_DIRECTIVE}}', wccDirective)
    .replaceAll('{{BRANCH_DIRECTIVE}}', branchDirective)
    .replaceAll('{{TITLE}}', args.title ? String(args.title) : '(use the ClickUp task title)');

  const claudeArgs = [
    '--print',
    '--output-format', 'json',
    '--model', model,
    '--dangerously-skip-permissions',
    '--allowedTools', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
  ];

  if (args['dry-run']) {
    process.stdout.write(`# DRY RUN — would execute in cwd ${repo}:\n`);
    process.stdout.write(`${claudeBin} ${claudeArgs.join(' ')}\n\n`);
    process.stdout.write(`# stdin (prompt):\n${prompt}\n`);
    return;
  }

  log(`[relay] start story=${story} mode=${mode} model=${model} repo=${repo}`);
  const res = spawnSync(claudeBin, claudeArgs, {
    cwd: repo,
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: childEnv,
  });

  if (res.error) {
    log(`[relay] spawn error: ${res.error.message}`);
    die(`could not run ${claudeBin}: ${res.error.message}`);
  }
  if (res.stderr && res.stderr.trim()) log(`[relay] stderr: ${res.stderr.trim().slice(0, 2000)}`);

  const envelope = safeJson(res.stdout);
  const resultText = envelope ? envelope.result || '' : res.stdout || '';
  const outcome = extractOutcome(resultText);

  if (!outcome) {
    log('[relay] could not parse an outcome block from the run. Raw result (truncated):');
    log((resultText || '').slice(0, 4000));
    process.exit(1);
  }

  log(`[relay] status=${outcome.status} review=${outcome.review_id || story} pr=${outcome.pr_url || '-'}`);
  if (outcome.summary) log(`[relay] summary: ${outcome.summary}`);

  switch (outcome.status) {
    case 'completed': {
      log(`[relay] DONE — PR ${outcome.pr_url || '(none reported)'}`);
      // Deferred Copilot -> WCC sync: when a PR was opened, spawn a detached job
      // that waits for GitHub Copilot's review (it lands minutes later, after we
      // exit) and seeds its line-anchored findings into the WCC review. Lazy:
      // the sync creates a WCC page only if Copilot actually leaves findings.
      const prNum = (/\/pull\/(\d+)/.exec(outcome.pr_url || '') || [])[1];
      if (prNum) {
        const syncArgs = [join(ROOT, 'bin', 'relay-sync-copilot.mjs'), '--pr', prNum, '--story', story, '--repo', repo];
        if (args.title) syncArgs.push('--title', String(args.title));
        try {
          const fd = openSync(join(LOG_DIR, `relay-sync-${story}.log`), 'a');
          const child = spawn(process.execPath, syncArgs, { cwd: ROOT, env: childEnv, detached: true, stdio: ['ignore', fd, fd] });
          child.unref();
          log(`[relay] spawned Copilot->WCC sync (pid ${child.pid}) for PR #${prNum} — it waits for Copilot, then seeds findings. Log: .wcc/relay-sync-${story}.log`);
        } catch (e) {
          log(`[relay] could not spawn Copilot sync: ${e.message}`);
        }
      }
      process.exit(0);
      break;
    }
    case 'needs_human':
      log(`[relay] CHECKPOINT — waiting on ${JSON.stringify(outcome.waiting_on || [])} in WCC review "${outcome.review_id || story}". Answer in WCC (${wccUrl}) and click "Resume runner".`);
      process.exit(0); // a checkpoint is a normal pause, not a failure
      break;
    case 'failed':
      log(`[relay] FAILED — ${outcome.summary || 'no summary'}`);
      process.exit(1);
      break;
    default:
      log(`[relay] unknown status: ${outcome.status}`);
      process.exit(1);
  }
}

// Resolve the claude binary to an absolute path. spawnSync bypasses the shell,
// so a PATH-only `claude` (or a shell alias) fails under detached/background
// spawns. Prefer an explicit --claude-bin or $CLAUDE_BIN, then known install
// locations, falling back to bare `claude` (PATH) as a last resort.
function resolveClaude(explicit) {
  if (explicit) return explicit;
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const home = process.env.HOME || '';
  const candidates = [
    join(home, '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* keep trying */ }
  }
  return 'claude';
}

// `claude --print --output-format json` emits a JSON envelope; `.result` is the
// assistant's final text. Tolerate non-JSON stdout (return null -> fall back).
function safeJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Pull the LAST fenced ```json block out of the result text and parse it.
function extractOutcome(text) {
  const matches = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!matches.length) return null;
  try {
    return JSON.parse(matches[matches.length - 1][1].trim());
  } catch {
    return null;
  }
}

main();
