---
phase: 02-bar
plan: 02
type: tdd
wave: 2
depends_on: [01-foo]
requirements: [BAR-01]
---

<objective>Build the bar subsystem on top of foo.</objective>

<tasks>
<task type="auto" tdd="true">
  <name>Build the bar</name>
  <files>src/bar.js</files>
  <action>Implement `bar()` using foo.</action>
  <verify><automated>npm test</automated></verify>
  <done>bar works and tests pass</done>
</task>
</tasks>
