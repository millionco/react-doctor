# Release safety and GitHub Action versioning

This reference governs all release work. Root [AGENTS.md](../../AGENTS.md) makes every rule here binding.

## Release authorization

- MUST: Discourage minor and major Changesets. Do not add one unless the user explicitly requests that release level. Patch Changesets may be added without a separate request when appropriate.
- MUST: Never merge a Changesets release PR, including any `changeset-release/*` branch, without fresh, explicit user confirmation for that exact PR and version immediately before the merge.
- General instructions to merge, ship, land, or babysit green PRs do not authorize merging a release/version PR. Treat merging a PR that triggers publication as publishing the release.
- MUST: Never publish packages, push or move release tags, or trigger, approve, rerun, or merge a release/publish workflow without fresh, explicit user confirmation for the exact versions and packages involved.
- You may prepare, validate, and babysit a release candidate, but must stop before the first publishing action. Report the exact PR, versions, packages, tags, and workflows awaiting approval.
- These confirmation requirements also apply to GitHub Action releases described below. Once the user explicitly approves a specific release, follow all required versioning and tag steps.

## GitHub Action versioning

The composite GitHub Action is **versioned independently from the npm packages**. "The action" is `action.yml` in the repository root and these scripts it shells out to:

- `scripts/ensure-json-report.mjs`
- `scripts/normalize-changed-files.mjs`
- `scripts/render-github-action-comment.mjs`
- `scripts/resolve-package-spec.mjs`

Treat a change to any listed file as an action release. Keep the list in sync with `ACTION_RELEASE_FILES` in `scripts/recommend-action-version-bump.mjs`, the release guard.

Two tag namespaces coexist. Never conflate them:

- npm packages: `react-doctor@X.Y.Z`, `eslint-plugin-react-doctor@X.Y.Z`, and `oxlint-plugin-react-doctor@X.Y.Z`, created by Changesets in CI through `.github/workflows/publish.yml`
- GitHub Action: `v`-prefixed semver `vX.Y.Z` plus a floating major `vN`. Check `git tag --list 'v*'` before choosing a version

- MUST: prepare an Action version for every commit that touches the action files. Use a minor bump for `feat(action)`, a major bump for a breaking input, output, or runtime change, and a patch bump otherwise
- MUST: after the user authorizes the exact release and you create `vX.Y.Z`, move the floating `vN` tag to the same commit
- Tags are GPG-signed annotated tags (`tag.gpgsign=true`), so a bare `git tag vX` will demand a message and fail in scripts. Always create/move with an explicit message:

```bash
# new release at the commit that changed the action
git tag -a vX.Y.Z commit_sha -m "react-doctor action vX.Y.Z"
# move the floating major (force-update only the vN pointer)
git tag -fa vN commit_sha -m "react-doctor action vN (floating major -> vX.Y.Z)"
git push origin vX.Y.Z
git push --force origin vN
```

- MUST: never tell consumers to reference `@main` in documentation or examples. Recommend a full commit SHA pin with a trailing version comment for hardened CI, or `@vN` for convenience
