# Changelog

All notable changes to TaskForge are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/) (`0.x` while pre-stable). The app
and the VS Code extension share one version line — a single `vX.Y.Z` tag releases
both.

## [Unreleased]

_Work landed on `main` but not yet tagged goes here._

## [0.1.4-beta.2]

_Prerelease._

- **Task-list sidebar + one editor tab per task.** The activity-bar icon now opens
  a native **Tasks** tree (fed by `GET /api/reviews`, grouped by project and ordered
  like the ⌘K palette) instead of collapsing the sidebar and forcing the app
  fullscreen. Nothing opens until you pick a task; clicking one opens — or reveals —
  its own editor tab, pinned to that task via `?id=` (the app reads `?id=` and an
  optional `?view=` as an initial override, falling back to the shared `localStorage`
  key so standalone browser use is unchanged). A `viewsWelcome` **Start** button
  shows when the server is down, gated on a new `taskforge.serverUp` context key.
  The in-app ⌘K palette is unchanged.
- Anchor re-attach now applies a **surrounding-context gate**: a fuzzy match must
  keep enough of its stored prefix/suffix before it's trusted, so the same token on
  a different in-page tab (or an unrelated occurrence) orphans the anchor — flagged
  *outdated* — instead of bleeding the comment onto unrelated text. Legacy anchors
  with no stored context skip the gate.

## [0.1.4-beta.1]

_Prerelease._

- **Linked chats.** `thread.json` now records the AI chat sessions that took part
  in a task (`participants[]`, tool-agnostic). A **💬 chats** header control lists
  them and reopens each one — for Claude, straight into the VS Code chat panel via
  the `vscode://anthropic.claude-code/open?session=…` deep link. One is the
  **primary (root)** session. Recorded automatically by a `PostToolUse` hook
  ([.claude/settings.json](.claude/settings.json) → `bin/record-participant.mjs`).
  New API: `POST /api/review/:id/participants`, `…/participant-primary`,
  `…/participant-delete`.
- **Thread ids.** Each thread now shows its unique key as a **copyable chip**, so
  it's trivial to reference the exact thread in chat.
- **Auto-respond on submit.** Posting a question can trigger an AI reply instead of
  switching to the chat and saying "check the threads." New extension setting
  `taskforge.respondMode` (`deeplink-root` *(default)* / `headless-root` /
  `headless-reviewer` / `off`) plus an in-app **⚡ auto-ask** toggle. Default reopens
  the page's root chat with the question pre-filled — full context, one keystroke.
  Also adds `taskforge.resumeCommand` and `taskforge.claudeCliPath`.

## [0.1.3-beta.3]

_Prerelease._

- In-page **Find** (⌘F inside the webview) now drives its own match traversal via
  the CSS Custom Highlight API instead of `window.find()`. The input keeps focus
  while you type (it no longer jumped away after one keystroke), a live **"3 / 17"**
  match count is shown, and ⌘/Ctrl+A/C/V are scoped to the find input so they no
  longer trigger the page-wide handlers.
- Added **`taskforge.useTab(key, default)`** for in-page tabs/selection state. It
  persists the choice in `localStorage` (keyed by task id + key), so editing
  `Page.jsx` — which remounts the component — no longer knocks the reader back to
  the first tab. Documented as the standard over raw `useState`.

## [0.1.3-beta.2]

_Prerelease._

- Removed the committed `node_modules` symlink (a self-referential link that broke
  `npm install` / the build on Windows and clean checkouts) and added
  `package-lock.json`.
- Editor-tab icon is now themed: `panel.iconPath` points at fixed light/dark grey
  variants (`taskforge-tab-{light,dark}.svg`) so the tab icon matches other tabs
  instead of rendering a solid-black currentColor glyph.

## [0.1.3-beta.1]

_Prerelease._

- Code Review sidebar is now a GitHub-style **file tree** (with file-type icons)
  that jumps to a file's section in the diff. The findings/comments index moved
  into a floating, per-tab **threads bubble** — Code Review threads and Log
  threads are kept separate.
- Replaced the theme dropdown + translucency toggle with a single **palette
  control**: one popover for Palette, a **Transparency** slider (thins the app
  backing so an editor vibrancy blur can show through — panels stay solid), and
  decorative **Backdrop** effects (Glow, Wash, Grid, Dotted grid, Hatch, Grain,
  Aurora) with an Intensity slider.
- The VS Code webview host is now transparent so the transparency setting can
  actually reach a vibrancy blur behind the panel.

## [0.1.2-beta.1]

_Prerelease._

- New TaskForge icon — an anvil with hammer and sparkles — for the VS Code
  activity bar, replacing the placeholder glyph. Tightened viewBox and a bolder
  outline so it reads at 16–24px.

## [0.1.0]

Baseline release.

- Three-tab task workspace (Log / Code Review / QA Plan) backed by plain
  `work/<id>/` files — no DB, no telemetry, nothing leaves the machine.
- Live `git diff` streaming with annotations re-attached by hunk id.
- Claude reviewer bridge over `thread.json`; `taskforge-review` + `taskforge-worklog` skills.
- `gsd-bridge` (import/capture a GSD `.planning/` tree) and `feature-stream`
  supervised loop.
- ⌘K command palette + Manage modal task switcher, ⌘F in-page find bar, and
  Navy / Dark neutral / Light themes.
- VS Code extension (webview panel + Start button + status bar).
- Optional `taskforge` MCP controller for detached server lifecycle.

[Unreleased]: https://github.com/o1evo/TaskForge/compare/v0.1.4-beta.2...HEAD
[0.1.4-beta.2]: https://github.com/o1evo/TaskForge/compare/v0.1.4-beta.1...v0.1.4-beta.2
[0.1.4-beta.1]: https://github.com/o1evo/TaskForge/compare/v0.1.3-beta.3...v0.1.4-beta.1
[0.1.3-beta.3]: https://github.com/o1evo/TaskForge/compare/v0.1.3-beta.2...v0.1.3-beta.3
[0.1.3-beta.2]: https://github.com/o1evo/TaskForge/compare/v0.1.3-beta.1...v0.1.3-beta.2
[0.1.3-beta.1]: https://github.com/o1evo/TaskForge/compare/v0.1.2-beta.1...v0.1.3-beta.1
[0.1.2-beta.1]: https://github.com/o1evo/TaskForge/releases/tag/v0.1.2-beta.1
[0.1.0]: https://github.com/o1evo/TaskForge/releases/tag/v0.1.0
