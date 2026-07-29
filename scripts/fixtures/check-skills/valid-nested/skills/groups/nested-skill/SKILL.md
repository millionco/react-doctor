---
name: nested-skill
description: Validate a nested skill fixture without requiring external checkouts.
metadata:
  model: inherited
---

# Nested skill

Read the [nested reference](references/details.md#details), [local asset](assets/prompt.txt),
and [external documentation](https://example.com/skill). The [reference-style link][details]
resolves locally.

Run `node $SKILL_DIR/scripts/check.mjs`. A user can still invoke `/deslop` or provide
`$HOME/Developer/project`, `<external-checkout>/examples`, or a
[relative external checkout](../../../../../../external/SKILL.md).

[details]: references/details.md
