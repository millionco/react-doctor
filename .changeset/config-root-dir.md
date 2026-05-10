---
"react-doctor": minor
---

Add a `rootDir` field to `react-doctor.config.json` (and the
`reactDoctor` key in `package.json`). When set, the CLI, `scan()`, and
`diagnose()` redirect the project directory they target to
`<configDirectory>/<rootDir>` (or to `rootDir` itself when absolute) so
the config can live at the repo root while scans target a subproject
like `apps/web` — no `cd` or explicit path argument needed.

Resolution rules:

- `rootDir` is resolved relative to the directory that contained the
  config file (or the `package.json` with the `reactDoctor` key), not
  the CWD. Absolute paths are used as-is.
- If the resolved path does not exist or is not a directory, the
  redirect is ignored with a warning and the originally requested
  directory is used.
- The CLI prints a one-line dimmed notice on redirect (suppressed
  under `--json` / `--score`).
- This also disambiguates wrappers that previously threw
  `AmbiguousProjectError`: setting `rootDir: "apps/web"` at a repo
  root with no root `package.json` and multiple nested React projects
  picks `apps/web` deterministically.
