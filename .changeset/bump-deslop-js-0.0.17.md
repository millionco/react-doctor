---
"react-doctor": patch
---

Bump bundled `deslop-js` to `^0.0.17`, which stops `deslop/unused-dev-dependency` from false-positiving on dependencies referenced in a `package.json` script as a flag argument rather than the leading command — e.g. `jest --testResultsProcessor jest-sonar-reporter` or `--reporters=jest-junit` (#653).
