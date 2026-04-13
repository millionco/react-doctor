# Middleware

Middleware customizes the behavior of server requests and server functions. It is composable, chainable, and dependency-aware.

## Two middleware types

| | Request Middleware | Server Function Middleware |
|---|---|---|
| Scope | All server requests (routes, SSR, server fns) | Server functions only |
| Methods | `.server()` | `.client()`, `.server()` |
| Input validation | No | Yes (`.inputValidator()`) |
| Client-side logic | No | Yes |
| Dependencies | Can depend on request middleware | Can depend on both types |

Request middleware **cannot** depend on server function middleware.

## Creating middleware

### Request middleware

```tsx
import { createMiddleware } from '@tanstack/react-start'

const loggingMiddleware = createMiddleware().server(async ({ next, request }) => {
  console.log('Request:', request.url)
  const result = await next()
  return result
})
```

### Server function middleware

```tsx
const authMiddleware = createMiddleware({ type: 'function' })
  .client(async ({ next }) => {
    return next({
      headers: { Authorization: `Bearer ${getToken()}` },
    })
  })
  .server(async ({ next }) => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
    return next({ context: { session } })
  })
```

## Method order (enforced by types)

```
createMiddleware({ type: 'function' })
  .middleware([...deps])     // 1. Dependencies
  .inputValidator(schema)    // 2. Input validation
  .client(({ next }) => {})  // 3. Client-side logic
  .server(({ next }) => {})  // 4. Server-side logic
```

## Composition and chaining

Middleware can depend on other middleware:

```tsx
const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = await auth.getSession({ headers: request.headers })
  if (!session) throw new Error('Unauthorized')
  return next({ context: { session } })
})

const adminMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(async ({ next, context }) => {
    if (context.session.role !== 'admin') throw new Error('Forbidden')
    return next()
  })
```

## Context management

### Passing context downstream

Call `next()` with a `context` object — it merges into the parent context:

```tsx
const middleware = createMiddleware({ type: 'function' }).server(({ next }) => {
  return next({
    context: { isAwesome: true },
  })
})
```

### Client → Server context

Client context is NOT sent to the server by default. Use `sendContext` explicitly:

```tsx
const middleware = createMiddleware({ type: 'function' })
  .client(async ({ next, context }) => {
    return next({
      sendContext: { workspaceId: context.workspaceId },
    })
  })
  .server(async ({ next, context }) => {
    // Validate dynamic client-sent data before using
    const workspaceId = z.string().parse(context.workspaceId)
    return next()
  })
```

Always validate client-sent context on the server — it is user-controlled.

### Server → Client context

```tsx
const serverTimer = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  return next({
    sendContext: { timeFromServer: new Date() },
  })
})
```

## Authentication pattern

The standard auth middleware pattern:

```tsx
// middleware.ts
export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = await auth.getSession({ headers: request.headers })
  if (!session) throw new Error('Unauthorized')
  return next({ context: { session } })
})
```

### Middleware factories for authorization

```tsx
type Permissions = Record<string, string[]>

export const authorizationMiddleware = (permissions: Permissions) => {
  return createMiddleware({ type: 'function' })
    .middleware([authMiddleware])
    .server(async ({ next, context }) => {
      const granted = await auth.hasPermission(context.session, permissions)
      if (!granted) throw new Error('Forbidden')
      return next()
    })
}
```

Usage:

```tsx
export const getClients = createServerFn()
  .middleware([authorizationMiddleware({ client: ['read'] })])
  .handler(async ({ context }) => {
    return { message: 'Authorized' }
  })
```

## Using with routes

### All handlers

```tsx
export const Route = createFileRoute('/foo')({
  server: {
    middleware: [loggingMiddleware],
    handlers: {
      GET: () => { /* ... */ },
      POST: () => { /* ... */ },
    },
  },
})
```

### Per-handler

```tsx
export const Route = createFileRoute('/foo')({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        GET: {
          middleware: [loggingMiddleware],
          handler: () => { /* ... */ },
        },
      }),
  },
})
```

## Global middleware

Create `src/start.ts` to register middleware that runs on every request:

```tsx
// src/start.ts
import { createStart, createMiddleware } from '@tanstack/react-start'

const globalRequestMiddleware = createMiddleware().server(({ next }) => {
  // runs on every request
  return next()
})

const globalFunctionMiddleware = createMiddleware({ type: 'function' }).server(({ next }) => {
  // runs on every server function
  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [globalRequestMiddleware],
  functionMiddleware: [globalFunctionMiddleware],
}))
```

## Execution order

Global middleware runs first, then dependency-first through the chain:

```
globalMiddleware1 → globalMiddleware2 → dep_a → dep_b → dep_c → handler
```

## Rules

- **DO** always call `next()` — forgetting it silently breaks the chain.
- **DO** validate any `sendContext` from client on the server side.
- **DO** use middleware factories for parameterized authorization rules.
- **DO NOT** send large payloads from client to server via `sendContext`.
- **DO NOT** have request middleware depend on server function middleware.
- **DO** use `src/start.ts` for cross-cutting concerns (logging, observability, auth).
