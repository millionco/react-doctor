# Server Functions

Server functions run on the server but can be called from anywhere — loaders, components, hooks, event handlers, or other server functions. The build process replaces implementations with RPC stubs on the client.

## Creating server functions

```tsx
import { createServerFn } from '@tanstack/react-start'

export const getServerTime = createServerFn().handler(async () => {
  return new Date().toISOString()
})
```

Specify HTTP method when mutation is involved:

```tsx
export const saveData = createServerFn({ method: 'POST' }).handler(async () => {
  return { success: true }
})
```

GET is the default method. Use POST for anything that mutates state.

## Input validation

Always validate inputs — data crosses a network boundary:

```tsx
import { z } from 'zod'

const UserSchema = z.object({
  name: z.string().min(1),
  age: z.number().min(0),
})

export const createUser = createServerFn({ method: 'POST' })
  .inputValidator(UserSchema)
  .handler(async ({ data }) => {
    return `Created user: ${data.name}, age ${data.age}`
  })
```

For Zod v3, wrap with `zodValidator()` from `@tanstack/zod-adapter`. Zod v4 works directly.

### FormData validation

```tsx
export const submitForm = createServerFn({ method: 'POST' })
  .inputValidator((data) => {
    if (!(data instanceof FormData)) {
      throw new Error('Expected FormData')
    }
    return {
      name: data.get('name')?.toString() || '',
      email: data.get('email')?.toString() || '',
    }
  })
  .handler(async ({ data }) => {
    return { success: true }
  })
```

## File organization

For larger codebases, split server code by naming convention:

| Suffix | Purpose | Safe to import on client? |
|---|---|---|
| `.functions.ts` | `createServerFn` wrappers | Yes — build replaces with RPC stubs |
| `.server.ts` | Server-only helpers (DB queries, secrets) | No — only import inside `.handler()` |
| `.ts` (no suffix) | Shared types, schemas, constants | Yes |

```
src/utils/
├── users.functions.ts   # createServerFn wrappers
├── users.server.ts      # DB queries, internal logic
└── schemas.ts           # Shared Zod schemas
```

### Example

```tsx
// users.server.ts
import { db } from '~/db'

export const findUserById = async (id: string) => {
  return db.query.users.findFirst({ where: eq(users.id, id) })
}
```

```tsx
// users.functions.ts
import { createServerFn } from '@tanstack/react-start'
import { findUserById } from './users.server'

export const getUser = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    return findUserById(data.id)
  })
```

## Calling server functions

### In route loaders

```tsx
export const Route = createFileRoute('/posts')({
  loader: () => getPosts(),
})
```

### In components (with useServerFn)

```tsx
import { useServerFn } from '@tanstack/react-start'

const PostList = () => {
  const getPosts = useServerFn(getServerPosts)
  const { data } = useQuery({
    queryKey: ['posts'],
    queryFn: () => getPosts(),
  })
}
```

### With parameters

```tsx
await getUser({ data: { id: '123' } })
```

## Error handling and redirects

### Redirects

```tsx
import { redirect } from '@tanstack/react-router'

export const requireAuth = createServerFn().handler(async () => {
  const user = await getCurrentUser()
  if (!user) {
    throw redirect({ to: '/login' })
  }
  return user
})
```

### Not found

```tsx
import { notFound } from '@tanstack/react-router'

export const getPost = createServerFn()
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const post = await db.findPost(data.id)
    if (!post) {
      throw notFound()
    }
    return post
  })
```

## Server context utilities

Access request/response details inside handlers:

```tsx
import {
  getRequest,
  getRequestHeader,
  setResponseHeaders,
  setResponseStatus,
} from '@tanstack/react-start/server'

export const getCachedData = createServerFn({ method: 'GET' }).handler(async () => {
  const authHeader = getRequestHeader('Authorization')

  setResponseHeaders(new Headers({
    'Cache-Control': 'public, max-age=300',
  }))

  setResponseStatus(200)
  return fetchData()
})
```

## Rules

- **DO** validate all server function inputs — they cross a network boundary.
- **DO** use `POST` for mutations, `GET` (default) for reads.
- **DO** use static imports for server functions — the bundler handles tree-shaking.
- **DO NOT** dynamically import server functions — causes bundler issues.
- **DO NOT** put secrets or DB logic directly in `.functions.ts` — isolate in `.server.ts`.
- **DO** throw `redirect()` and `notFound()` inside handlers for control flow.
