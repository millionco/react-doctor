# Testing and validation

Use this reference to select tests and validate a change. Root [AGENTS.md](../../AGENTS.md) requires these checks before a commit.

Tests live beside source in package `tests/` directories or next to the implementation when the package already uses colocated tests.

- `packages/core/tests/`: engine, service, discovery, and orchestration tests
- `packages/api/tests/`: API shell and boundary tests
- `packages/react-doctor/tests/`: CLI, rendering, cache, compatibility, and end-to-end tests
- `packages/oxlint-plugin-react-doctor/src/`: rule, semantic-engine, and evaluator tests

The test framework is `vite-plus/test`, the existing Vitest wrapper.

Run the narrowest relevant test while iterating. Before committing, run:

```bash
nr test
nr lint
nr typecheck
nr format:check
nr smoke:json-report
```

Run each additional check owned by the changed surface:

```bash
nr architecture:check
nr test:architecture
nr compatibility:check
nr test:compatibility
nr test:build-policy
nr skills:check
nr build
nr check:published-deps
nr smoke:packed-cli-install
```

- Run `nr test:deslop` after changing `deslop-js` or `deslop-cli`
- Run `nr --filter oxlint-plugin-react-doctor gen:check` after changing rule registration or generated inputs
- Run `nr skills:check` after changing `AGENTS.md`, `.agents/references/`, `.agents/skills/`, or `skills/`
- Run packed compatibility checks after changing a published package's files, exports, binary, or bundled assets

Do not treat a focused test as proof of repository-wide compatibility. Match validation depth to the affected boundary, then run the pre-commit matrix.
