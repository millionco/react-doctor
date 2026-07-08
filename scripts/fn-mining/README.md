# FN mining

A repeatable false-negative mining harness for `oxlint-plugin-react-doctor`
rules. Each case is a **syntactic variant** of a rule's documented bad
pattern — same underlying problem, different surface shape (arithmetic on
the index, a template literal, an aliased import, indirection through a
variable, a different loop kind). The runner executes every variant against
its rule and reports which ones did NOT fire. Those silent variants are
**false-negative candidates** for human triage.

## Run

```bash
pnpm fn-mining
```

The runner always exits 0 — it is a mining/report tool, not a CI gate. A
silent variant is not automatically a bug: many rules deliberately trade
recall for precision (documented carve-outs, name gates, same-file-proof
requirements). Every silent variant needs a human to read the rule source
and decide: real FN worth fixing, or deliberate scoping.

The script runs through `tsx` (provided transitively by `vite-plus`)
rather than `node --experimental-strip-types` like the other root scripts,
because it imports the plugin's TypeScript sources, whose internal
`./x.js`-suffixed imports Node's type stripping cannot resolve.

## Adding cases

1. Pick a rule where detection breadth matters (pattern-matching rules, not
   simple attribute checks). Read its source under
   `packages/oxlint-plugin-react-doctor/src/plugin/rules/` to understand
   exactly what it matches — the goal is probing edge shapes it might miss,
   not re-testing its canonical example.
2. Create `cases/<rule-id>.ts` exporting an array of `FnMiningCase`:

```ts
import type { FnMiningCase } from "../fn-mining-case.js";

export const myRuleCases: FnMiningCase[] = [
  {
    ruleId: "my-rule", // the rule's public id (ruleRegistry key)
    description: "index offset by arithmetic: key={index + 1}",
    filePath: "src/list.tsx", // drives parser lang + file-based gates
    code: `...`,
    shouldFire: true,
  },
];
```

3. Register the array in `cases/index.ts`.
   When triage concludes a silent variant is deliberate rule scoping, keep
   the case but set `shouldFire: false` and explain the gate in
   `carveOutReason` — the runner then prints it as `[carved]` instead of
   re-flagging it as an FN candidate, and warns if it ever starts firing
   (a precision regression).
4. Include one or two canonical "must fire" variants as a baseline — if
   those go silent, the case itself is broken (wrong file path hitting a
   testlike-filename gate, a missing import a rule's import check needs,
   etc.), not the rule.

Case-writing notes:

- `filePath` matters. Rules tagged `test-noise` skip testlike filenames
  (`*.test.tsx`, `*.stories.tsx`); scan rules skip non-production paths.
  Use a production-looking path unless the file-based gate is itself what
  you are probing.
- AST rules run through `runRule` (the same pure-TS oxc-parser host the
  unit tests use); rules with a `scan` function run through `runScanRule`
  against an in-memory file. The runner picks automatically based on the
  rule shape in the registry.
- Framework gating (`requires: ["react-native"]` etc.) is a registry-level
  concern and does not apply here — the rule logic runs directly.

## Interpreting output

Per rule, each variant prints as `[fired]` or `[SILENT]`, followed by a
summary and the aggregated FN-candidate list. Triage each silent variant
by reading the rule source:

- **Real FN candidate** — the variant is the same user-visible problem and
  the miss is an implementation gap (e.g. the key-expression walker not
  handling `key={i + 1}` while handling `key={\`item-${i}\`}`).
- **Deliberate scoping** — the rule author chose precision over recall and
  the source says so (e.g. spread props may carry the missing attribute,
  same-file memo proof required, name-gated index parameters).

Report real FNs with a pointer into the rule source (file:line of the
check that bails) so the fix conversation starts concrete.
