#!/usr/bin/env node
// Hermetic smoke test for the GSD bridge (bin/import-gsd.mjs + bin/capture-gsd.mjs).
// No test framework: runs the tools against test/fixtures/gsd-planning, asserts the
// contract, and exits non-zero on any failure. Run with `npm run test:gsd`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Babel from '@babel/standalone';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test/fixtures/gsd-planning/.planning');
const ID = 'gsd-smoketest';
const WORK = join(ROOT, 'work', ID);

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };
const node = (file, args) => execFileSync('node', [join(ROOT, 'bin', file), ...args], { encoding: 'utf8' });

// Compile a Page.jsx exactly as src/components/PageRuntime.jsx does.
function compiles(src) {
  try {
    const norm = src.replace(/^\s*import\s.*$/gm, '').replace(/export\s+default\s+/g, '');
    const { code } = Babel.transform(norm, { presets: ['react'], filename: 'Page.jsx' });
    const React = { createElement: () => null };
    const Page = new Function('React', `const {useState,useEffect,useRef,useMemo,useCallback}=React;\n${code}\n;return Page;`)(React);
    Page({ wcc: { Markdown: () => null, Thread: () => null } });
    return true;
  } catch (e) { console.log('    compile error:', e.message); return false; }
}

const sandbox = mkdtempSync(join(tmpdir(), 'gsd-smoke-'));
try {
  // ── READ half ──────────────────────────────────────────────────────────────
  console.log('import-gsd:');
  node('import-gsd.mjs', ['--planning', FIXTURE, '--id', ID, '--title', 'Smoke']);
  ok(existsSync(join(WORK, 'Page.jsx')), 'Page.jsx written');
  ok(existsSync(join(WORK, 'thread.json')), 'thread.json written');
  ok(existsSync(join(WORK, 'qa-plan.md')), 'qa-plan.md written');

  const page = readFileSync(join(WORK, 'Page.jsx'), 'utf8');
  ok(compiles(page), 'Page.jsx compiles + renders through the runtime pipeline');
  ok(page.includes('01-foo') && page.includes('02-bar'), 'both phases embedded');
  ok(page.includes('"log:phase:" + ph.name'), 'per-phase discussion threads emitted (provenance hook)');
  ok(page.includes('Built the foo subsystem'), 'phase blurb lifted from SUMMARY');

  const qa = readFileSync(join(WORK, 'qa-plan.md'), 'utf8');
  ok(qa.includes('Bar renders for a fresh tenant'), 'QA plan seeded from latest phase UAT');

  // ── WRITEBACK half — both routing paths ──────────────────────────────────────
  console.log('capture-gsd:');
  const thread = {
    review: { id: ID, title: 'Smoke', repo: null, base: null, head: null, createdAt: '2026-01-01T00:00:00.000Z' },
    hunks: [], threads: {
      'log:phase:01-foo': [
        { id: 'a', role: 'reviewer', text: '**Decision:** Foo uses the singular convention.', ts: '2026-01-01T01:00:00.000Z', answered: true },
      ],
      'log:gsd-discussion': [
        { id: 'b', role: 'reviewer', text: '**Decision:** A global, non-phase decision.', ts: '2026-01-01T01:01:00.000Z', answered: true },
      ],
    },
  };
  writeFileSync(join(WORK, 'thread.json'), JSON.stringify(thread, null, 2) + '\n');

  cpSync(FIXTURE, join(sandbox, '.planning'), { recursive: true });
  node('capture-gsd.mjs', ['--id', ID, '--planning', join(sandbox, '.planning')]);

  const caps = readFileSync(join(sandbox, '.planning', 'WCC-CAPTURES.md'), 'utf8');
  ok(/phases\/01-foo\/01-CONTEXT\.md \(phase decision\)/.test(caps), 'phase-anchored decision routes to the phase CONTEXT');
  ok(/PROJECT\.md → Key Decisions/.test(caps), 'global decision routes to PROJECT Key Decisions');
  ok(readFileSync(join(sandbox, '.planning', 'STATE.md'), 'utf8') === readFileSync(join(FIXTURE, 'STATE.md'), 'utf8'),
     'capture leaves GSD-reconstructed STATE.md byte-identical');

  // Idempotency: a second run captures nothing new.
  const before = caps.length;
  node('capture-gsd.mjs', ['--id', ID, '--planning', join(sandbox, '.planning')]);
  ok(readFileSync(join(sandbox, '.planning', 'WCC-CAPTURES.md'), 'utf8').length === before, 'second capture is idempotent (no duplicates)');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(WORK, { recursive: true, force: true });
}

console.log(failures ? `\nFAIL — ${failures} assertion(s) failed` : '\nPASS — all assertions green');
process.exit(failures ? 1 : 0);
