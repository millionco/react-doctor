# Linting

TanStack provides official ESLint plugins for Router and Query that catch real bugs and enforce correct patterns.

## @tanstack/eslint-plugin-router

### Installation

```bash
pnpm add -D @tanstack/eslint-plugin-router
```

### Configuration (ESLint 9+ flat config)

Recommended (all rules):

```js
// eslint.config.js
import pluginRouter from '@tanstack/eslint-plugin-router'

export default [
  ...pluginRouter.configs['flat/recommended'],
]
```

Custom rule selection:

```js
export default [
  {
    plugins: {
      '@tanstack/router': pluginRouter,
    },
    rules: {
      '@tanstack/router/create-route-property-order': 'error',
      '@tanstack/router/route-param-names': 'error',
    },
  },
]
```

### Rules

#### `create-route-property-order` (fixable)

Enforces the correct order of inference-sensitive properties in `createFileRoute`, `createRoute`, `createRootRoute`, and `createRootRouteWithContext`.

The required order:

```
1. params, validateSearch
2. loaderDeps, search.middlewares, ssr
3. context
4. beforeLoad
5. loader
6. onEnter, onStay, onLeave, head, scripts, headers, remountDeps
```

Wrong order breaks TypeScript type inference silently — the loader may receive `unknown` context instead of the typed value from `beforeLoad`.

#### `route-param-names`

Validates that route parameter names are valid JavaScript identifiers:

- Must start with a letter, underscore, or dollar sign
- Cannot contain hyphens or dots
- Applies to `$param`, `{$param}`, and `{-$optionalParam}` syntaxes

```
✓  posts.$postId.tsx
✓  users.$userId.posts.tsx
✗  posts.$post-id.tsx      ← hyphen in param name
✗  posts.$post.id.tsx      ← dot in param name
```

## @tanstack/eslint-plugin-query

If using TanStack Query alongside Start:

```bash
pnpm add -D @tanstack/eslint-plugin-query
```

```js
import pluginQuery from '@tanstack/eslint-plugin-query'

export default [
  ...pluginQuery.configs['flat/recommended'],
]
```

### Rules

- **`exhaustive-deps`** — Query key must include all variables used in the query function.
- **`stable-query-client`** — `QueryClient` must be created outside of components.
- **`no-unstable-deps`** — Prevents unstable references in query function closures.
- **`no-void-query-fn`** — Query functions must return a value.

## TypeScript ESLint integration

### Handling redirect() and notFound()

TanStack Router uses `throw redirect()` and `throw notFound()` for control flow. If you use `@typescript-eslint/only-throw-error`, configure exceptions:

```js
export default [
  {
    rules: {
      '@typescript-eslint/only-throw-error': ['error', {
        allow: [
          { from: 'package', package: '@tanstack/react-router', name: ['redirect', 'notFound'] },
        ],
      }],
    },
  },
]
```

Or use the `allowThrowingUnknown` option if the above syntax is not supported in your version.

## Oxlint alternative

For projects using Oxlint instead of ESLint, the TanStack-specific rules are not available. Supplement with:

- TypeScript strict mode for type-level catches
- Manual code review for property order (or use the ESLint plugin as a CI-only check)

## Rules

- **DO** enable `@tanstack/router/create-route-property-order` — it auto-fixes the most common TanStack Router bug.
- **DO** enable `@tanstack/router/route-param-names` to catch invalid param identifiers.
- **DO** use the recommended config rather than cherry-picking — new rules are added over time.
- **DO** configure `@typescript-eslint/only-throw-error` exceptions for `redirect` and `notFound`.
- **DO** add `@tanstack/eslint-plugin-query` if using TanStack Query.
