---
"oxlint-plugin-react-doctor": patch
---

fix(react-builtins): `jsx-no-jsx-as-prop` recognises more conventional JSX
slot props mined from the real-world corpus — the `*Avatar`, `*Text`,
`*State`, and `*Zone` suffixes (material-ui `ListItem
leftAvatar`/`primaryText`, supabase `ChartContent loadingState`, leemons
`leftZone`/`rightZone`), the `config` slot, and capitalised exact forms of
known slot names (`Footer={<PageFooter />}`). Inline JSX in these slots is the
component's designed API, so flagging it was unactionable noise. Found by the
fuzz FP oracle.
