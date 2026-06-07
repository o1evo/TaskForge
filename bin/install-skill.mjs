#!/usr/bin/env node
// Make the in-repo Claude skills available *globally* by symlinking each one
// into ~/.claude/skills/. This is OPTIONAL: when you run Claude Code inside this
// repo, the skills under .claude/skills/ are auto-discovered with no install. Run
// this only if you want to drive reviews from *other* repos/clones too.
//
// Usage:
//   node bin/install-skill.mjs            # symlink all skills into ~/.claude/skills
//   node bin/install-skill.mjs --copy     # copy instead of symlink (no live updates)
//   node bin/install-skill.mjs --force    # replace an existing skill of the same name
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync,
  rmSync, symlinkSync, cpSync,
} from 'node:fs';

const args = new Set(process.argv.slice(2));
const COPY = args.has('--copy');
const FORCE = args.has('--force');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.claude', 'skills');
const DEST = join(homedir(), '.claude', 'skills');

if (!existsSync(SRC)) {
  console.error(`error: no skills found at ${SRC}`);
  process.exit(1);
}
mkdirSync(DEST, { recursive: true });

const skills = readdirSync(SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (!skills.length) {
  console.log('No skills to install.');
  process.exit(0);
}

for (const name of skills) {
  const from = join(SRC, name);
  const to = join(DEST, name);

  if (existsSync(to) || isSymlink(to)) {
    // Already pointing at our copy? Nothing to do.
    if (isSymlink(to) && resolve(dirname(to), readlinkSync(to)) === from) {
      console.log(`= ${name} (already linked)`);
      continue;
    }
    if (!FORCE) {
      console.log(`! ${name} exists at ${to} — pass --force to replace`);
      continue;
    }
    rmSync(to, { recursive: true, force: true });
  }

  if (COPY) {
    cpSync(from, to, { recursive: true });
    console.log(`+ ${name} (copied)`);
  } else {
    symlinkSync(from, to, 'dir');
    console.log(`+ ${name} (linked → ${from})`);
  }
}

console.log(`\nDone. Skills available in ${DEST}.`);

function isSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}
