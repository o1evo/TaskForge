function Page({ wcc }) {
  const box = { maxWidth: 820, margin: '0 auto', padding: '4px 8px 40px' };
  const card = { border: '1px solid #30363d', borderRadius: 10, padding: '14px 16px', margin: '14px 0', background: '#0d1117' };
  return (
    <div style={box}>
      <h1 style={{ marginBottom: 4 }}>👋 Welcome to Work Command Center</h1>
      <p style={{ color: '#8b949e', marginTop: 0 }}>
        This is a sample task so a fresh clone isn&apos;t empty. The <strong>Log</strong> tab
        (this page) is a bespoke, interactive React page Claude writes <em>per task</em> —
        status, findings, a timeline, whatever fits. The other two tabs hold the diff and the QA plan.
      </p>

      <div style={card}>
        <wcc.Markdown text={`### The three tabs
- **Log** — *this* page. Claude authors it as \`work/<id>/Page.jsx\` and it re-renders live as Claude edits it.
- **Code Review** — an annotated diff with per-hunk / per-line chat threads.
- **QA Plan** — a plain-Markdown test plan with a copy button.

Everything is local files under \`work/<id>/\` — no DB, no network, nothing leaves your machine.`} />
      </div>

      <h3>What changed in this task</h3>
      <p>
        We made <wcc.CodeRef file="src/greet.js" line={3} /> handle an empty name and switched
        to a template string. Click that reference — it jumps to the exact line in the Code Review tab.
      </p>

      <h3>Talk to the reviewer</h3>
      <p style={{ color: '#8b949e' }}>
        A separate Claude Code session joins as the reviewer and answers threads. This one is
        anchored to this section of the page (try selecting text anywhere here to start a new one):
      </p>
      <wcc.Thread target="log:welcome" title="Ask about WCC" />

      <p style={{ color: '#6e7681', fontSize: 13, marginTop: 24 }}>
        Done exploring? Delete <code>work/sample/</code>, then import your own change with{' '}
        <code>node bin/import.mjs --repo &lt;path&gt; --base main --head HEAD --title "…"</code>.
      </p>
    </div>
  );
}
