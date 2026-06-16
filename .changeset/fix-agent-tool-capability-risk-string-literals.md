---
"oxlint-plugin-react-doctor": patch
---

Fix `agent-tool-capability-risk` false positives when a capability keyword appears only in prose (#838).

The rule already blanked comments before its keyword scan but still matched the dangerous-capability pattern inside string literals. An AI-SDK tool whose `description` happened to contain a capability word as prose — e.g. `description: "...ALWAYS fetch the underlying numbers first"` — fired the rule even though no shell/fs/network primitive was wired to the handler. The keyword scan now blanks string-literal interiors (preserving offsets, so reported lines/columns stay correct), via a new opt-in `ignoreStringLiterals` flag on the shared `scanByPattern` helper. A real call site outside the quotes — `exec(command)`, `fetch(url)` — still fires.
