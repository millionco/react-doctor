---
"@react-doctor/core": patch
---

Stop react-doctor from flagging its own toolchain as an unused dependency

After `react-doctor install` — especially via `bunx`, where react-doctor is
declared in `package.json` but never materialized in `node_modules` — a scan
reported `react-doctor` itself as an unused devDependency. It's used via the CLI,
git hooks, CI, and the agent skill (never imported in source), so the dead-code
import graph can't see it, and deslop's "ships a binary → used" heuristic can't
read its `bin` when it isn't installed. The dead-code pass now never reports
react-doctor's own CLI / plugin packages (`react-doctor`,
`eslint-plugin-react-doctor`, `oxlint-plugin-react-doctor`) as unused.

Closes #961
