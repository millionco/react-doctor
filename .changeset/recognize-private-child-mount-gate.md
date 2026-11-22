---
"oxlint-plugin-react-doctor": patch
---

Recognize browser reads in a private child whose sole JSX use is behind a React effect mount gate.

Also recognize a private arrow component guarded by a short-circuit expression when only a React effect can enable it.
