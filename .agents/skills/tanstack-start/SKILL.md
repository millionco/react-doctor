---
name: tanstack-start
description: Best practices and conventions for TanStack Start — the full-stack React framework built on TanStack Router. Use when building routes, server functions, middleware, data loading, SEO, or configuring linting for a TanStack Start project.
metadata:
  tags: tanstack, start, router, server-functions, middleware, ssr, full-stack, react
---

## When to use

Use this skill whenever you are working inside a TanStack Start project or writing code that touches TanStack Router file-based routes, `createServerFn`, `createMiddleware`, route loaders, search parameter validation, or `head` meta management.

## How to use

Read individual rule files for detailed patterns and code examples:

- [rules/routing.md](rules/routing.md) - File-based routing conventions and naming
- [rules/data-loading.md](rules/data-loading.md) - Route loaders, search params, and the critical property order
- [rules/server-functions.md](rules/server-functions.md) - `createServerFn` patterns and file organization
- [rules/middleware.md](rules/middleware.md) - Middleware composition, auth, and context passing
- [rules/navigation.md](rules/navigation.md) - Type-safe `Link`, `useNavigate`, and search params
- [rules/head-and-seo.md](rules/head-and-seo.md) - Document head management and SEO
- [rules/linting.md](rules/linting.md) - ESLint plugin rules and TypeScript integration
- [rules/project-structure.md](rules/project-structure.md) - File layout, app config, and deployment

## Quick reference

### Route property order (inference-sensitive — must follow this order)

```
1. params, validateSearch
2. loaderDeps, search.middlewares, ssr
3. context
4. beforeLoad
5. loader
6. onEnter, onStay, onLeave, head, scripts, headers, remountDeps
```

### Server function file naming

| Suffix | Purpose | Safe to import on client? |
|---|---|---|
| `.functions.ts` | `createServerFn` wrappers | Yes |
| `.server.ts` | Server-only helpers (DB, internal logic) | No |
| `.ts` (no suffix) | Types, schemas, constants | Yes |

### Middleware chain method order (enforced by types)

```
createMiddleware({ type: 'function' })
  .middleware([...])
  .inputValidator(schema)
  .client(async ({ next }) => { ... })
  .server(async ({ next, context }) => { ... })
```
