# Relay — story checkpoint loop (PoC)

Relay runs a Finario ClickUp story with a headless Claude, and when Claude hits a
genuine product decision it posts a **code-anchored question into WCC** and stops.
A human answers in WCC (in the diff context), clicks **Resume runner**, and a fresh
Claude reconstructs from the branch + thread + task and continues — until a PR is
opened. See the design doc: open WCC and pick **"Relay — the story checkpoint loop"**.

This is the **local PoC**: one box, no tunnel, no daemon. f2 stays untouched; the
runner (prompt + schema + launcher) lives here in the WCC repo and operates on a
real f2 checkout.

## Pieces

| File | Role |
|------|------|
| `bin/relay-prompt.md` | The runner prompt — checkpoint policy + WCC posting + reconstruction. `{{...}}` placeholders are filled by the launcher. |
| `bin/relay-schema.json` | The structured outcome contract (status / skills_used / summary / pr_url / **review_id** / **waiting_on**). |
| `bin/relay-run.mjs` | The launcher — runs ONE `claude --print` pass, parses the outcome, routes on status. No loop. |
| `POST /api/review/:id/run` | WCC endpoint that spawns the launcher detached (the **Resume runner** button). |

## Prerequisites (the runner is headless — no interactive MCP)

- **ClickUp token at `~/.config/clickup/api_key`.** A headless `claude --print` cannot use the ClickUp MCP (OAuth is interactive), so it relies on the `clickup` skill's direct-API fallback, which reads this file. Set it up once (prompts for the token, never prints it):
  ```bash
  bash /Users/kassiter/code/ai-base/.claude/skills/clickup/scripts/store-api-key.sh
  ```
  **Without it the runner aborts with `status: failed`** — by design, it will never guess a story's intent.
- **Ruby 2.6.10** for local specs (`RBENV_VERSION=2.6.10 bundle exec rspec`); the default 2.7 fails to boot f2 on Rails 4.2.

## Run a story

**First run** (creates the WCC review from the working-tree diff):

```bash
node bin/relay-run.mjs \
  --repo /Users/kassiter/code/f2-parallel/f2 \
  --story cu-<taskid> \
  --title "<story title>"
```

`--story` is the WCC review id (use the `cu-<taskid>` convention so it pairs with
the ClickUp task). The review then appears in the WCC sidebar.

**Resume** (after answering a checkpoint in WCC): click **▶ Resume runner** in the
WCC header — or from the CLI:

```bash
node bin/relay-run.mjs --repo <f2-path> --story cu-<taskid> --resume
```

**Dry run** (print the composed prompt + command, execute nothing):

```bash
node bin/relay-run.mjs --repo <f2-path> --story cu-<taskid> --dry-run
```

## The loop

1. Kick off (CLI, above). Claude reads the ClickUp task, works on a
   `feature/ai-…-CU-<taskid>` branch, and imports its working-tree diff into WCC.
2. At a product/intent ambiguity it posts a question anchored to a line
   (`role: reviewer`), commits WIP, and exits `needs_human`.
3. The story shows **N awaiting reviewer** in WCC. Open it, read the question in
   the diff, answer in the thread (you post as `role: author`).
4. Click **▶ Resume runner**. A fresh run reconstructs and continues.
5. Repeat until `completed` (PR opened) — then review the final diff in the
   Code Review tab.

Runner output is logged to `.wcc/relay-<story>.log`.

## What to watch (this decides whether to build Phase 2)

- How often does a real story hit `needs_human`?
- What fraction of questions are code-anchored vs. pure business?
- Did humans actually answer in WCC, faster/better than ClickUp?

## ⚠ Before you ever tunnel WCC

`POST /api/review/:id/run` executes a local process with no auth. That is fine for
a 127.0.0.1 single-box PoC. **Before exposing WCC via cloudflared or any network
interface, gate this endpoint behind authentication** — otherwise it is
unauthenticated remote code execution on the host.
