# Data Loading

TanStack Start coordinates data loading through the router. Route loaders run before rendering so the page has all data it needs upfront.

## Route property order (critical for type inference)

Properties in `createFileRoute` / `createRoute` / `createRootRoute` must follow this order. TypeScript inference breaks if you reorder them:

```
1. params, validateSearch
2. loaderDeps, search.middlewares, ssr
3. context
4. beforeLoad
5. loader
6. onEnter, onStay, onLeave, head, scripts, headers, remountDeps
```

All other properties (`component`, `pendingComponent`, `errorComponent`, `notFoundComponent`) are order-insensitive.

**Wrong — loader before beforeLoad:**

```tsx
export const Route = createFileRoute('/path')({
  loader: async ({ context }) => { /* context.hello is untyped */ },
  beforeLoad: () => ({ hello: 'world' }),
})
```

**Correct:**

```tsx
export const Route = createFileRoute('/path')({
  beforeLoad: () => ({ hello: 'world' }),
  loader: async ({ context }) => { /* context.hello is typed */ },
})
```

The ESLint rule `@tanstack/router/create-route-property-order` auto-fixes this.

## Route loaders

```tsx
export const Route = createFileRoute('/posts')({
  loader: async () => {
    return fetchPosts()
  },
  component: PostsPage,
})
```

Access loader data in components:

```tsx
const PostsPage = () => {
  const posts = Route.useLoaderData()
  return <PostList posts={posts} />
}
```

### Parallel data fetching

Avoid waterfalls — fetch in parallel:

```tsx
export const Route = createFileRoute('/dashboard')({
  loader: async () => {
    const [user, posts, notifications] = await Promise.all([
      fetchUser(),
      fetchPosts(),
      fetchNotifications(),
    ])
    return { user, posts, notifications }
  },
})
```

### Loader dependencies

Use `loaderDeps` to declare which search params the loader depends on. The loader re-runs only when these values change:

```tsx
export const Route = createFileRoute('/posts')({
  validateSearch: z.object({
    page: z.number().default(1),
    filter: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    page: search.page,
    filter: search.filter,
  }),
  loader: async ({ deps }) => {
    return fetchPosts({ page: deps.page, filter: deps.filter })
  },
})
```

## Search parameter validation

Use `validateSearch` with a schema validator. Place it before `loader` and `beforeLoad` in property order.

### Zod v4 (no adapter needed)

```tsx
import { z } from 'zod'

const searchSchema = z.object({
  query: z.string().min(1).max(100),
  page: z.number().int().positive().default(1),
  sortBy: z.enum(['name', 'date', 'relevance']).optional(),
  filters: z.array(z.string()).optional(),
})

export const Route = createFileRoute('/search')({
  validateSearch: searchSchema,
  component: SearchPage,
})
```

### Zod v3 (needs adapter)

```tsx
import { zodValidator } from '@tanstack/zod-adapter'
import { z } from 'zod'

export const Route = createFileRoute('/search')({
  validateSearch: zodValidator(searchSchema),
  component: SearchPage,
})
```

### Using validated search params

```tsx
const SearchPage = () => {
  const { query, page, sortBy } = Route.useSearch()
  // Fully typed and validated
}
```

## beforeLoad

Runs before the loader and can provide context, perform redirects, or set up auth:

```tsx
export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ context }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  loader: async ({ context }) => {
    // context.user is typed and available
    return fetchDashboard(context.user.id)
  },
})
```

## Pending and error states

### pendingComponent

Shows a loading skeleton after `pendingMs` elapses:

```tsx
export const Route = createFileRoute('/posts')({
  pendingMs: 200,
  pendingMinMs: 500,
  loader: async () => fetchPosts(),
  pendingComponent: () => <PostsSkeleton />,
  component: PostsPage,
})
```

`pendingComponent` displays during client-side navigation. During SSR page refresh, it does **not** show — the server waits for the loader to resolve.

### errorComponent

```tsx
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => fetchPost(params.postId),
  errorComponent: ({ error }) => (
    <div>
      <h2>Something went wrong</h2>
      <p>{error.message}</p>
    </div>
  ),
  component: PostPage,
})
```

### notFoundComponent

```tsx
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => {
    const post = await fetchPost(params.postId)
    if (!post) throw notFound()
    return post
  },
  notFoundComponent: () => <div>Post not found</div>,
  component: PostPage,
})
```

## Built-in SWR cache

TanStack Router caches loader data with stale-while-revalidate semantics. Previously visited routes load instantly from cache while revalidating in the background.

Configure staleness per route:

```tsx
export const Route = createFileRoute('/posts')({
  staleTime: 30_000,
  loader: async () => fetchPosts(),
})
```

## Rules

- **DO** follow the property order — it is not optional for TypeScript inference.
- **DO** use `Promise.all` for parallel fetches in loaders.
- **DO** declare `loaderDeps` when the loader depends on search params.
- **DO** validate search params with a schema — never trust raw URL input.
- **DO** throw `redirect()` in `beforeLoad` for auth guards, not in the component.
- **DO** throw `notFound()` in loaders for missing resources.
- **DO NOT** fetch data in components when it can be done in loaders.
