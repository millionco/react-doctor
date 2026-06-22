---
"oxlint-plugin-react-doctor": patch
---

fix(rn-no-raw-text): recognize common text-wrapper component names

Adds `Button`, `Chip`, `Badge`, `Pill`, `Tab`, and `Link` to the text-component keyword list so the rule recognizes these common text-rendering wrappers when they're imported from another file (and the single-file auto-detection can't see their implementation).

Keyword matching now matches a whole PascalCase word instead of any substring, so a short keyword like `Tab` recognizes `<Tab>`/`<TabBar>` without shadowing unrelated components that merely contain it (`<Table>`, `<DataTable>`, `<Hyperlink>`), where raw text is still a real crash. Precedence is also adjusted so auto-detection wins over the name heuristic for locally-defined components.

Fixes #873
