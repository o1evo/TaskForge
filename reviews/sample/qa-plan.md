# QA Plan — friendlier `greet()`

A sample plan showing the format: group cases by **capability**, tier them **P0–P3**,
and give each a **Do / Pass / Hits**. Use the **Copy markdown** button to lift it into
a ticket or email.

## Capability: greeting output

### P0 — empty / missing name
- **Do:** call `greet("")` and `greet(undefined)`
- **Pass:** returns `"Hello there!"` — never `"Hello !"`
- **Hits:** the empty-name guard in `src/greet.js`

### P1 — normal name
- **Do:** call `greet("Ada")`
- **Pass:** returns `"Hello Ada!"`
- **Hits:** the template-string path

### P2 — whitespace-only name (known follow-up)
- **Do:** call `greet("   ")`
- **Pass:** *currently* returns `"Hello    !"` — trimming is a tracked follow-up, not a blocker for this change
- **Hits:** a future `name.trim()` (not yet implemented)

## Capability: version export

### P3 — `VERSION` constant
- **Do:** `import { VERSION } from "./greet.js"`
- **Pass:** equals `"1.0.0"`
- **Hits:** the new `export const VERSION`
