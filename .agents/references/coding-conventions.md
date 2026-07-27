# Code conventions

Use this reference for every code change. Root [AGENTS.md](../../AGENTS.md) makes these rules binding.

## Package commands

- MUST use `ni` to install dependencies, `nr SCRIPT_NAME` to run a declared script, and `nun` to remove dependencies
- Run workspace scripts with `nr --filter workspace_name script_name`
- Do not invoke `npm run` or `pnpm run` manually when `nr` can run the same script
- Existing `package.json` scripts may use `pnpm` for workspace plumbing. Do not rewrite those script bodies only to replace the package-manager command

## TypeScript

- Use an interface for an object contract that callers construct, implement, or extend
- Use a type alias for unions, primitives, tuples, function signatures, mapped or conditional types, schema-derived types, and re-exports
- Declare shared types at module scope in the narrowest owning module. Do not add ambient global declarations unless a global runtime integration requires them
- Prefer arrow functions when an arrow and a declaration express the same behavior. Use declarations when the language or framework requires them, including generators and overloads
- Avoid type assertions. Assert only at a validated boundary that TypeScript cannot narrow, and keep the assertion next to that validation
- Use `Boolean(value)` instead of `!!value`

## Ownership and naming

- Use kebab-case file names
- Use descriptive variable names. Revisit names after the behavior is clear
- Keep a helper beside its only consumer. Move it into a domain `utils/` directory only when several files reuse a domain-neutral leaf operation
- Keep each utility file focused. A `utils/` directory is not the default home for domain behavior
- Keep a constant beside its owning domain. Use a domain `constants.ts` only when several files share the constants
- Extract a number when its meaning, unit, or reuse matters. Use `SCREAMING_SNAKE_CASE` and a unit suffix such as `_MS` or `_BYTES` when the value has a unit
- Remove unused code and consolidate repeated behavior
- Search the codebase and compare viable designs before choosing the smallest design that preserves the package boundaries

## Comments

- Do not restate code in comments. Comment only an invariant, compatibility constraint, non-obvious tradeoff, or external reason that the code cannot express
- Prefix a temporary or surprising workaround with `// HACK:` and state why it exists

## Public surface

Before changing a command, flag, score, config, JSON report, package API, GitHub Action, website, or terminal output, run the [product-thinking skill](../skills/product-thinking/SKILL.md). Lint rules use the rule pipeline instead.

## Symbol search and deduplication

`@rayhanadev/truffler` is a dev dependency that fuzzy-searches JavaScript and TypeScript symbols through `oxc-parser`. Use it to avoid duplicate code. The [find-similar-functions skill](../skills/find-similar-functions/SKILL.md) defines the full workflow.

Before adding a utility, helper, type, constant, or rule:

- Search for an existing symbol to reuse or extend
- Derive queries from the proposed name, domain noun, and verb
- Search the narrowest root first, then read the top matches

After finishing a task, search for each added symbol. Delete code the change superseded.

```bash
bunx @rayhanadev/truffler "<query>" packages --kind function,method,interface,type,constant --limit 20
```

The repository pins `@rayhanadev/truffler`. Bun runs its TypeScript entry directly. Start with a narrow root such as `packages/core/src`; broaden only if the first search finds nothing.
