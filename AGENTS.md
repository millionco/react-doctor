# React Doctor agent guide

This file is the durable entry point for repository work. Read each reference that owns the area you change. Every `MUST`, `ALWAYS`, `NEVER`, and release-authorization rule in those references is binding.

## Start here

- **Any code change**: read [code conventions](.agents/references/coding-conventions.md) for commands, types, naming, comments, ownership, and mandatory `truffler` checks
- **Package ownership or imports**: read [repository architecture](.agents/references/repository-architecture.md)
- **Effect code, services, errors, or logging**: read [Effect v4 conventions](.agents/references/effect-v4.md)
- **Telemetry, OTLP, Sentry, metrics, or privacy**: read [observability](.agents/references/observability.md)
- **Tests or a commit**: read [testing and validation](.agents/references/testing.md)
- **Changesets, package publication, tags, GitHub Action files, or release workflows**: read [release safety and GitHub Action versioning](.agents/references/release-safety.md) before any action

## Non-negotiable gates

- Use `ni` to install, `nr SCRIPT_NAME` to run a declared script, and `nun` to uninstall. Use `nr --filter workspace_name script_name` for a workspace script
- Search with `truffler` before adding a utility, helper, type, constant, or rule, and again after the task to remove duplicates or dead code
- Before a public-surface change, run the [product-thinking skill](.agents/skills/product-thinking/SKILL.md). Public surface includes CLI flags and commands, score, config, JSON report, package APIs, GitHub Action, website, and terminal output. Lint rules follow the rule pipeline
- Before a commit, run the checks in [testing and validation](.agents/references/testing.md)
- Never publish, tag, move a release tag, or merge or operate a release workflow without the fresh, exact user confirmation required by [release safety and GitHub Action versioning](.agents/references/release-safety.md)

## Optional external references

- An Effect checkout can provide additional examples through its `.patterns/effect.md`
- A `react-doctor-evals` checkout can provide additional runtime examples

Neither checkout is required. The tracked references above define the binding repository conventions.
