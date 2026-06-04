---
name: find-similar-functions
description: Use truffler to find similar or pre-existing JavaScript/TypeScript symbols before implementing new code, especially helpers, utilities, parsers, formatters, scanners, fuzzy matchers, and other reusable functions. Agents should use this skill whenever they are about to add or refactor functionality in a JS/TS repository and need to avoid duplicating existing code, even if the user does not explicitly mention deduplication.
---

# Similar Function Finder

Use this skill before writing new JavaScript or TypeScript code that might overlap with existing helpers. The goal is to discover nearby functions, methods, constants, types, and interfaces early enough to reuse or extend them instead of creating duplicate behavior.

`truffler` is a fuzzy symbol search tool. Treat it as a discovery layer: it points you to likely symbols, but you still need to inspect the code before deciding whether something is reusable.

## Workflow

1. State the behavior you are about to implement in a few words.
2. Derive 3-6 search queries from the intended behavior:
   - the proposed function or class name
   - domain nouns, such as `symbol`, `path`, `file`, `route`, `token`, or `config`
   - verbs, such as `parse`, `normalize`, `discover`, `scan`, `format`, `rank`, `score`, `resolve`, or `validate`
   - common abbreviations and synonyms, such as `btn` for `button` or `cfg` for `config`
3. Run `truffler` against the narrowest useful root first, then broaden if needed.
4. Inspect the top matches with normal code-reading tools before editing.
5. Prefer reusing, extending, or moving existing code when the behavior substantially matches. Create new code only after the search shows there is not a suitable existing symbol.
6. In your final response, briefly mention what you found and whether you reused something or intentionally added a new implementation.

## Command Recipes

When `truffler` is installed in the target project:

```bash
truffler "normalize path" src --kind function,method,constant,type --limit 20
truffler "score" src --kind function,method --format json --limit 15
```

When working inside this `truffler` repository:

```bash
bun src/cli.ts "discover file" src --kind function,method,constant,type --limit 20
bun src/cli.ts "format result" src --kind function,method --format json --limit 15
```

When the project has no installed binary and you should not add dependencies, use `bunx` if network/package execution is acceptable for the environment:

```bash
bunx @rayhanadev/truffler "parse config" src --kind function,method,type --limit 20
```

If `truffler` cannot be run, say so and fall back to the repository's available search tools. Still follow the same deduplication intent: search before implementing.

## Search Strategy

Start with symbols most likely to represent reusable behavior:

```bash
truffler "<query>" <root> --kind function,method,constant,type,interface --limit 20
```

Use JSON output when you need structured fields for ranking, locations, signatures, or automation:

```bash
truffler "<query>" <root> --format json --limit 20
```

Broaden deliberately:

- If a precise function name has no match, search the domain noun and verb separately.
- If a utility may live outside `src/`, try known library, package, app, or test roots.
- If there are many matches, restrict `--kind` and reduce the root rather than skimming unrelated output.
- If top matches look close, read the implementation and nearby tests or call sites before deciding.

## Reuse Decision Guide

Consider an existing symbol reusable when it already handles the same input shape, side effects, error behavior, and return shape, or when a small extension would preserve its current contract.

Avoid reusing a symbol just because its name is close. Fuzzy matches can surface unrelated code. Inspect signatures, implementation, callers, and tests before changing anything.

When no suitable symbol exists, keep the new implementation near the closest related module and align with that module's naming, error handling, and test style.

## Reporting Template

Use a short note like this when the search affects your implementation:

```markdown
I checked for existing symbols with `truffler` using queries like `normalize`, `path`, and `resolve`. The closest match was `normalizePath` in `src/files.ts`, so I reused that behavior instead of adding a separate helper.
```

If nothing relevant exists:

```markdown
I searched with `truffler` for `parse`, `config`, and `loadConfig` across `src/`; the matches were unrelated, so I added a new helper in the nearest module.
```
