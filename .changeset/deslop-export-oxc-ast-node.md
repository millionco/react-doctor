---
"deslop-js": patch
---

Expose the `isOxcAstNode` type guard and its `OxcAstNode` interface from the package entry. These were already internal utilities; publishing them lets consumers walk oxc ASTs without re-declaring the same guard. No runtime behavior changes.
