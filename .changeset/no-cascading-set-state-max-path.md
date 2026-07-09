---
"oxlint-plugin-react-doctor": patch
---

`no-cascading-set-state` now models control flow accurately: mutually-exclusive `if`/`else` and ternary branches contribute the MAX of their setter counts instead of the sum (only one branch runs per dispatch, so summing inflated the "N setState calls run together" count with writes that never co-run), and every synchronous nested function (`const handleKeyDown = () => {…}` DOM listeners, closures handed to helpers, function declarations in switch cases) is now its own scope boundary — previously only `async` functions were, so a sync closure's setters were summed into the effect's count.
