# File-Based Routing

TanStack Start uses file-based routing with routes in `src/routes/`.

## Directory structure

```
src/
├── router.tsx            # Router configuration
├── routeTree.gen.ts      # Auto-generated — never edit manually
└── routes/
    ├── __root.tsx         # Root layout wrapping all routes
    ├── index.tsx          # Matches /
    ├── about.tsx          # Matches /about
    ├── posts.tsx          # Layout for /posts/*
    ├── posts.index.tsx    # Matches /posts exactly
    └── posts.$postId.tsx  # Matches /posts/:postId
```

## Naming conventions

### Flat routes (dot separator)

Use `.` to express nesting without nested directories:

```
routes/
├── posts.tsx           # /posts layout
├── posts.index.tsx     # /posts (exact)
└── posts.$postId.tsx   # /posts/:postId
```

### Dynamic params

Prefix with `$`:

```
routes/posts.$postId.tsx        → /posts/:postId
routes/users.$userId.posts.tsx  → /users/:userId/posts
```

Parameter names must be valid JS identifiers — no hyphens or dots. The ESLint rule `@tanstack/router/route-param-names` enforces this.

### Catch-all (splat) routes

Use `$` alone:

```
routes/files.$.tsx  → /files/*
```

### Pathless layout routes

Prefix with `_`:

```
routes/
├── _authenticated.tsx          # Layout — no URL segment
├── _authenticated.dashboard.tsx  # /dashboard (wrapped by layout)
└── _authenticated.settings.tsx   # /settings (wrapped by layout)
```

### Route groups

Wrap directory names in `()` — they organize files without affecting the URL:

```
routes/
├── (auth)/login.tsx    # /login
└── (auth)/register.tsx # /register
```

### Excluding files from the route tree

Prefix with `-`:

```
routes/
├── posts.$postId.tsx
└── -posts-helpers.ts   # Colocated logic, not a route
```

### Escaping special characters

Wrap in `[]`:

```
routes/script[.]js.tsx  → /script.js
```

### Directory-based routes

Use `.route.tsx` suffix inside a directory:

```
routes/
└── posts/
    ├── route.tsx        # Same as posts.tsx
    └── $postId/
        └── route.tsx    # Same as posts.$postId.tsx
```

## Root route

`__root.tsx` must exist in the routes directory root. It wraps every route:

```tsx
import { createRootRoute, Outlet, HeadContent, Scripts } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
})
```

## Server routes

Server routes live alongside app routes and handle HTTP methods:

```tsx
export const Route = createFileRoute('/api/users')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(await getUsers())
      },
      POST: async ({ request }) => {
        const body = await request.json()
        return Response.json(await createUser(body))
      },
    },
  },
})
```

Combine server and client in the same route file:

```tsx
export const Route = createFileRoute('/hello')({
  server: {
    handlers: {
      POST: async ({ request }) => { /* ... */ },
    },
  },
  component: HelloComponent,
})
```
