---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Detect unconditional impure operations in inline state updaters from installed `@rc-component/util` 1.13.0 controlled-state hooks when both package entries prove an unchanged native React setter. Unsupported dependency routing and missing dependencies remain outside this detection path.
