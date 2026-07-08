---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

Second-round FP/FN sweep: restore delta-audit recall regressions, wire confirmed false-negative clusters (jsx-no-target-blank, button-has-type, no-default-props), repair the never-firing no-layout-property-animation rule, reconcile no-array-index-as-key, gate RN boxShadow rules on new-architecture provenance, and skip the vulnerability axis for devDependencies in the supply-chain check.
