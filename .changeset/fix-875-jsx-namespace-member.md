---
"deslop-js": patch
---

Fix `deslop/unused-export` false positive for namespace-imported components used in JSX

A component referenced only through a namespace import in JSX —
`import * as S from "./style"` then `<S.Custom />` — was reported as an unused
export. The usage walker recorded namespace member access in regular expressions
(`MemberExpression`, e.g. `S.helper()`) but not in JSX (`JSXMemberExpression`),
so a member used solely as `<S.x />` was missed whenever the namespace had any
other accessed member. Closes #875.
