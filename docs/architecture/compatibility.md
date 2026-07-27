# Compatibility guarantees and snapshots

In this repository, a compatibility guarantee is observable behavior that existing users can rely
on. Examples include package exports, CLI flags and help text, diagnostics, JSON reports, exit
codes, and runtime errors.

The word “contract” is still used in code where it has a precise meaning:

- a public contract is behavior promised to users;
- an internal contract is a narrow interface between two subsystems;
- a contract test runs multiple implementations through the same behavior suite.

The old root `contracts/` directory did not contain interfaces or specifications. It contained
machine-generated golden snapshots, so that evidence now lives beside the repository-wide tooling
that owns it under `scripts/compatibility/`.

## Repository layout

- `scripts/compatibility/snapshots/public-packages.json` records published package manifests and
  exports;
- `scripts/compatibility/snapshots/packed-public-entry-points.json` records installed runtime entry
  points, export keys, and packed-file policies;
- `scripts/compatibility/snapshots/cli-help.json` records every supported CLI help surface;
- `scripts/compatibility/approved-deltas.json` records reviewed temporary differences between old
  and new implementations.

The public `oxlint-plugin-react-doctor/contracts` package subpath is different: it is a supported API
entry point for shared rule and capability vocabulary. Renaming it would break consumers, so the
compatibility rewrite preserves it.

## Commands

```bash
nr compatibility:check
nr test:compatibility
nr smoke:packed-cli-install
```

After intentionally changing a published package surface:

```bash
nr compatibility:update
nr compatibility:packed:update
```

Snapshot updates are review evidence, not an automatic fix. Review the diff and confirm that the
change is additive or otherwise authorized before committing it.

## Approved differences

An old/new mismatch must not be hidden by loose normalization. Add a temporary entry to
`scripts/compatibility/approved-deltas.json` only when it has an owner, rationale, exact observed
difference, expiry condition, and removal issue. The normal state is an empty list.
