# Skills

Model-loadable skill files in [Anthropic skill format](https://docs.claude.com/en/docs/claude-code/skills) (frontmatter + markdown body). They auto-trigger when the user's task matches the skill's `description` line.

## Index

### React Doctor (project-local)

| Skill                                   | When it loads                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [react-doctor](react-doctor/SKILL.md)   | Finishing a feature, fixing a bug, before committing React code, or when the user types `/doctor`, asks to scan, triage, or clean up React diagnostics |
| [rule-research](rule-research/SKILL.md) | Stage 1 of the rule pipeline — define a rule contract                                                                                                  |
| [rule-writing](rule-writing/SKILL.md)   | Stage 2 — turn a rule contract into tests + implementation                                                                                             |
| [rule-validate](rule-validate/SKILL.md) | Stage 3 — verify noise, correctness, PR copy, and review feedback                                                                                      |

### Preact (sourced from [JoviDeCroock/skills](https://github.com/JoviDeCroock/skills))

These are integrated verbatim from Jovi De Croock's Preact-and-Signals skill set, the canonical guidance for code-assistant harnesses working on Preact codebases. Jovi maintains the upstream copies; sync from `https://github.com/JoviDeCroock/skills/tree/main/<skill-name>/SKILL.md` when bumping.

#### Setup and configuration

| Skill                                                             | When it loads                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [preact-no-build-vite-setup](preact-no-build-vite-setup/SKILL.md) | Starting a project: Vite, no-build, or integrating into an existing pipeline |
| [preact-typescript-jsx](preact-typescript-jsx/SKILL.md)           | TypeScript + JSX transform, `jsxImportSource`, namespace augmentation        |
| [preact-compat-aliasing](preact-compat-aliasing/SKILL.md)         | Using React libraries via `preact/compat` — bundler, SSR, Jest aliases       |

#### Runtime debugging

| Skill                                                     | When it loads                                             |
| --------------------------------------------------------- | --------------------------------------------------------- |
| [preact-hooks-debugging](preact-hooks-debugging/SKILL.md) | Invalid hook calls, `__H` errors, duplicate Preact copies |
| [preact-debug-warnings](preact-debug-warnings/SKILL.md)   | Interpreting `preact/debug` output                        |

#### Forms and UI

| Skill                                               | When it loads                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| [preact-forms-events](preact-forms-events/SKILL.md) | Controlled vs. uncontrolled inputs, `onInput` vs. `onChange`, form hydration |

#### SSR and hydration

| Skill                                                               | When it loads                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| [preact-ssr-prerendering](preact-ssr-prerendering/SKILL.md)         | `preact-render-to-string`, streaming, `preact-iso` prerender |
| [preact-hydration-mismatches](preact-hydration-mismatches/SKILL.md) | Diagnosing SSR/client DOM divergence                         |

#### Signals

| Skill                                                                           | When it loads                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [preact-signals-core](preact-signals-core/SKILL.md)                             | `@preact/signals-core`: signal, computed, effect, batch, untracked                   |
| [preact-signals-preact-integration](preact-signals-preact-integration/SKILL.md) | `@preact/signals` in Preact: `useSignal`, `useComputed`, JSX rendering, `Show`/`For` |
| [preact-signals-react-integration](preact-signals-react-integration/SKILL.md)   | `@preact/signals-react` with React 18/19                                             |
| [preact-signals-models-utils](preact-signals-models-utils/SKILL.md)             | Signal-based model patterns and utilities                                            |
| [preact-signals-debugging](preact-signals-debugging/SKILL.md)                   | Diagnosing stale values, missing updates, loops                                      |
| [preact-signals-testing](preact-signals-testing/SKILL.md)                       | Testing signal-driven code                                                           |
| [preact-signals-no-build](preact-signals-no-build/SKILL.md)                     | Using signals in no-build / CDN setups                                               |
| [preact-signals-eslint-plugin](preact-signals-eslint-plugin/SKILL.md)           | `@preact/eslint-plugin-signals` rules                                                |

#### Extending Preact

| Skill                                                 | When it loads                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| [preact-options-hooks](preact-options-hooks/SKILL.md) | Building plugins/devtools via `options` hooks, internal VNode access |

## Harness-specific wiring

`SKILL.md` files use Anthropic's standard frontmatter and work in any harness that reads it. Per-harness install paths:

- **Claude Code** — copy or symlink directories into `~/.claude/skills/` (user-level) or `.claude/skills/` (project-level). Auto-triggers on the `description` field.
- **Cursor** — copy each `SKILL.md` body into `.cursor/rules/<name>.mdc` and prepend the Cursor frontmatter (`description`, `globs`, `alwaysApply: false`).
- **Windsurf / Continue / Aider** — consume the `SKILL.md` body as a rule or system-prompt fragment.
- **Raw system prompts** — paste the relevant `SKILL.md` body into your system prompt when the user's task matches the `description`.
