---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Require local callback or literal array evidence before treating an opaque lowercase argument to `find` or `findLast` as an array predicate. This avoids warnings on query APIs while preserving existing callback and known-array checks. Opaque predicates on receivers without array-origin evidence remain outside this check, including some real array-access risks.
