---
"oxlint-plugin-react-doctor": patch
---

Add native SSA to the control-flow graph and a path-sensitive dead-assignment rule.

`@react-doctor/cfg` now builds variable-level **static single assignment** form over its oxc-native CFG via the Braun, Buchwald, Hack et al. (2013) on-the-fly sealed-block algorithm — the same algorithm the React Compiler's `EnterSSA` implements — followed by their redundant-φ elimination pass. It is a clean-room port (no Babel, MIT attribution): a minimal value model (`SsaIdentifier` / `Place` / `Phi`), per-instruction read/write extraction, a self-contained lexical binding resolver with an injectable seam (the plugin feeds in its own scope analyzer's binding identities), and an `analyzeSsa` query API (`versionAt`, `reachingDefinition`, `isLiveValue`, `isRedefinedBetween`, `bindingOf`, per-function φ + def blocks). The parity suite asserts the Braun φ placement equals the iterated dominance frontier of each binding's definitions (Cytron et al.), and `toDot` renders φ-functions.

New `no-dead-assignment` rule uses it: it flags a write to a reassignable local whose value is never read because every path overwrites it first (`let total = expensive(); total = cheap(); return total;`). This is a value-flow question pure control flow can't answer — it complements `no-unused-vars` (which only sees wholly-unused bindings) and stays quiet for `const`, compound assignments, closure-captured bindings, and any write whose value is read on some path.
