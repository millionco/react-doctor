---
"oxlint-plugin-react-doctor": patch
---

Stop no-impure-state-updater flagging a data parameter forwarded to a setter. `resolveToFunction` mistook a `Parameter` definition (whose node is the enclosing function) for the updater, so idiomatic handlers like `(row) => { setSelected(row); setOpen(true) }` were reported. The shared resolver now rejects parameter bindings, which also removes a local workaround in no-pass-data-to-parent.
