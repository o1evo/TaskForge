---
phase: 01-foo
plan: 01
type: tdd
wave: 1
depends_on: []
requirements: [FOO-01, FOO-02]
files_modified:
  - src/foo.js
  - test/foo.test.js
autonomous: true
must_haves:
  truths:
    - "Foo renders without throwing"
    - "Foo wires to the bar"
---

<objective>Build the foo subsystem.</objective>

<tasks>

<task type="auto" tdd="true">
  <name>Wire the bar widget</name>
  <files>src/foo.js</files>
  <action>Implement `foo()` and connect it to the bar. See the existing pattern.</action>
  <verify><automated>npm test</automated></verify>
  <done>foo renders and tests pass</done>
</task>

</tasks>
