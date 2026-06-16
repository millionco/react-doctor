---
"oxlint-plugin-react-doctor": patch
---

Fix `server-sequential-independent-await` false positive on awaits whose dependency flows through nested destructuring (#839).

The rule's binding collector only saw top-level `Identifier` bindings and shallow object/array pattern elements, so names bound through a nested pattern — e.g. `const [{ slug }, { isEnabled }] = await Promise.all([...])` — were invisible. A follow-up `await client.fetch(BlogPostQuery, { slug }, isEnabled ? ... : ...)` that genuinely depended on those names was wrongly flagged as an independent waterfall. The collector now reuses the recursive `collectPatternNames` utility, so nested array/object patterns, defaulted bindings, and rest elements all count as a real dependency.
