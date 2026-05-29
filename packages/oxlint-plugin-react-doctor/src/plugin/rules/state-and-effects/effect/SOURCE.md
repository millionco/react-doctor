# Ported from `eslint-plugin-react-you-might-not-need-an-effect`

Upstream: https://github.com/NickvanDyke/eslint-plugin-react-you-might-not-need-an-effect

- Upstream package: `eslint-plugin-react-you-might-not-need-an-effect`
- Upstream commit SHA at time of port: `4c71faaa7623d2d5feb33983dc2ebcc08206bcc5`
- Upstream version at time of port: `0.10.1` (HEAD of `main`)
- Upstream license: **MIT** (Copyright © 2025 Nick van Dyke)

The eight rules listed below are native TypeScript ports of the
upstream ESLint plugin's rule set. They preserve upstream's scope-aware
reference chasing and diagnostic messages where the oxlint host exposes
enough source information.

| Rule ID (this package, `react-doctor/<id>`) | Upstream file                                    |
| ------------------------------------------- | ------------------------------------------------ |
| `no-derived-state`                          | `src/rules/no-derived-state.js`                  |
| `no-chain-state-updates`                    | `src/rules/no-chain-state-updates.js`            |
| `no-event-handler`                          | `src/rules/no-event-handler.js`                  |
| `no-adjust-state-on-prop-change`            | `src/rules/no-adjust-state-on-prop-change.js`    |
| `no-reset-all-state-on-prop-change`         | `src/rules/no-reset-all-state-on-prop-change.js` |
| `no-pass-live-state-to-parent`              | `src/rules/no-pass-live-state-to-parent.js`      |
| `no-pass-data-to-parent`                    | `src/rules/no-pass-data-to-parent.js`            |
| `no-initialize-state`                       | `src/rules/no-initialize-state.js`               |

## Why this lives under `react-doctor/`

Before this port, the upstream rules were activated as
`effect/<rule-id>` via `eslint-plugin-react-you-might-not-need-an-effect`
discovered at scan time by `packages/core/src/runners/oxlint/plugin-resolution.ts`.
After this port, the same rule semantics ship inside
`oxlint-plugin-react-doctor` so projects no longer need the optional
peer dependency. The pre-existing thematically-related rules
(`no-derived-state-effect`, `no-effect-chain`, `no-event-trigger-state`,
`no-prop-callback-in-effect`) remain — they target different code
shapes with different messages.

## Impedance mismatch with the upstream

The upstream plugin is ESLint-native and uses
`context.sourceCode.getScope().references[]` plus
`ref.resolved.defs[].node.init/body` recursively to chase the
ultimate source of every value (its "upstream refs"). Oxlint JS
plugins do not hand JS rules an ESLint scope manager, so this port
builds one lazily per `Program` with `eslint-scope` in
`../utils/effect/get-program-analysis.ts`, then threads that
`ProgramAnalysis` through the helpers in `../utils/effect/ast.ts` and
`../utils/effect/react.ts`.

## Known divergences

- **Upstream TODO case** — the parity suite preserves upstream's own
  disabled `todo: true` case, "Set derived state via identical
  intermediate setter".
- **Diagnostic message templates** — upstream uses
  `messageId: "avoidDerivedState", data: { state: "fullName" }`,
  which ESLint expands via the `meta.messages` table. Oxlint plugins
  emit pre-substituted strings. Most substituted text matches upstream
  byte-for-byte; `no-initialize-state` uses a bounded AST stringifier
  where oxlint does not expose original source text.
- **`no-adjust-state-on-prop-change` severity + message** — upstream
  ships this rule as `type: "suggestion"` with softened "Avoid …
  Instead …" copy. We promote it to `severity: "error"` (the pattern
  always causes an extra render with a stale UI between the two
  commits — there is no benign instance) and rewrite the message in
  the authoritative "what's wrong → why → fix" shape used by the rest
  of the error-level effect rules in this folder. Detector behavior
  is unchanged; only the diagnostic copy and severity diverge.

## Upstream `LICENSE` (MIT, retained for attribution)

```
MIT License

Copyright (c) 2025 Nick van Dyke

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
