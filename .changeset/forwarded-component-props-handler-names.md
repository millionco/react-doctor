---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Allow function components to forward event-handler props through any props parameter name.
Avoid repeated analysis when a component forwards many event-handler props.

Keep handler naming warnings when destructuring or loop targets replace those event-handler properties.

Keep warnings when a component declaration's own name is called, passed elsewhere, or reassigned.

Cache binding-symbol lookups within each file to avoid repeated module scans when checking many components.
