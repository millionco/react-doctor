---
"oxlint-plugin-react-doctor": patch
---

A returned scalar formatter can use JSX only when its scalar input is null. React component props do not follow that path. Exclude these formatters while keeping warnings when JSX is reachable for normal props, a reassigned parameter, or another return path.
