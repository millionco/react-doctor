---
"react-doctor": patch
---

fix(react-doctor): support block comment forms of `react-doctor-disable-line` / `react-doctor-disable-next-line`

The inline-suppression matcher previously only recognized line comments
(`// react-doctor-disable-…`). Block comments — including the JSX form
`{/* react-doctor-disable-next-line … */}`, which is the only suppression
form legal directly inside JSX — were silently ignored, forcing users to
write `{/* // react-doctor-disable-line … */}` as a workaround. Both forms
now work, and either accepts a comma- or whitespace-separated rule list
or no rule id (suppress every diagnostic on the targeted line). Closes #144.
