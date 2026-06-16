---
"oxlint-plugin-react-doctor": patch
---

Fix `agent-tool-capability-risk` (and its sibling `mcp-tool-capability-risk`) false positives when a capability keyword appears only in prose (#838).

The rules already blanked comments before their keyword scan but still matched the dangerous-capability pattern inside string literals. A tool whose `description` happened to contain a capability word as prose — e.g. `description: "...ALWAYS fetch the underlying numbers first"` — fired even though no shell/fs/network primitive was wired to the handler. The keyword scan now blanks string-literal interiors (preserving offsets, so reported lines/columns stay correct), via a new opt-in `ignoreStringLiterals` flag on the shared `scanByPattern` helper.

Genuine signals still fire: a real call site outside the quotes (`exec(command)`, `fetch(url)`), a capability inside a template interpolation (`` `${fetch(url)}` `` — `${…}` is treated as code, not blanked), and a dangerous module specifier (`import { execFile } from "node:child_process"`, `require("axios")`) are all preserved.
