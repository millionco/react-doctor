# ReactBench artifact map

Use this reference when a benchmark audit needs exact evidence locations. The current consolidated corpus is:

```text
/home/aidenybai/Developer/react-bench-internal/jobs/ReactBench-v1.1-beta-rd-0.9.3-consolidated-final-20260801
```

Each trial normally contains `verifier/rd.log`, `verifier/rd-before.json`, `verifier/rd-after.json`, and `verifier/model.patch`, plus `result.json` and reward/test artifacts. Enumerate rather than assume filenames:

```bash
rg --files /home/aidenybai/Developer/react-bench-internal/jobs/ReactBench-v1.1-beta-rd-0.9.3-consolidated-final-20260801
```

Known evidence locations:

| Question                                       | Artifact                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| What did the model change?                     | `<trial>/verifier/model.patch`                                      |
| What did React Doctor report before and after? | `<trial>/verifier/rd-before.json`, `<trial>/verifier/rd-after.json` |
| Why did the verifier pass or fail?             | `<trial>/verifier/rd.log`                                           |
| Did tests pass?                                | `<trial>/result.json` and discovered reward/test logs               |
| What behavior was requested?                   | task README/prompt and `docs/aiden-review/**/README.md`             |

Representative trials that must be rechecked during the second pass:

- `fix-react-rdh-nteract-semiotic-a__5uDDmgx`: cheap `Map` ref initialization.
- `write-react-glific-glific-fronte__22Gg4p2`: cheap `Map` ref initialization.
- `fix-react-jumperexchange-jumper__2GBTh7Z`: media error state reset keyed by source props.
- `write-react-frankchen021-datasto__2N6xFwQ`: KaTeX HTML passed through a local alias.
- `fix-react-viclafouch-mui-tel-inp__hQXzJgB`: controlled-input parent synchronization.
- `fix-react-floating-ui-floating-u__27iKG4t`: controlled-selection focus handoff.
- `fix-react-formidablelabs-victory__2uwi2vz`: stale animation closure and async race behavior.
- `fix-react-igordanchenko-yet-anot__2GZGZYT`: guarded render-phase state update.
- `fix-react-rdh-appflowy-io-appflo__vK9uEUy`: previous-prop comparison with render-phase updates.

Treat these as starting points. The audit is incomplete unless it searches all trial directories and performs an independent second pass.
