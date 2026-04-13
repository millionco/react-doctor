# Navigation

TanStack Router provides fully type-safe navigation through the `Link` component and `useNavigate` hook. Search params, path params, and route paths are all type-checked.

## Link component

### Basic navigation

```tsx
import { Link } from '@tanstack/react-router'

<Link to="/about">About</Link>
<Link to="/posts/$postId" params={{ postId: '123' }}>View Post</Link>
```

### With search params (object)

Replaces all search params:

```tsx
<Link to="/products" search={{ category: 'electronics', page: 1 }}>
  Electronics
</Link>
```

### With search params (function)

Merges with existing params:

```tsx
<Link search={(prev) => ({ ...prev, page: (prev.page || 1) + 1 })}>
  Next Page
</Link>
```

### Preserve all search params

```tsx
<Link to="/other-page" search={true}>
  Keep current search params
</Link>
```

### Active state styling

```tsx
<Link
  to="/posts"
  activeProps={{ className: 'font-bold text-blue-600' }}
  inactiveProps={{ className: 'text-gray-500' }}
>
  Posts
</Link>
```

`Link` also supports `activeOptions` for controlling exact matching behavior.

## Programmatic navigation

### useNavigate

```tsx
import { useNavigate } from '@tanstack/react-router'

const MyComponent = () => {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate({
      to: '/search',
      search: { query: 'tanstack', page: 1 },
    })
  }

  const handleNextPage = () => {
    navigate({
      search: (prev) => ({ ...prev, page: prev.page + 1 }),
    })
  }
}
```

### navigate from route context

Inside `beforeLoad` or `loader`:

```tsx
export const Route = createFileRoute('/protected')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) {
      throw redirect({ to: '/login' })
    }
  },
})
```

Use `redirect()` in loaders/beforeLoad — not `navigate()`.

## Type-safe route paths

TanStack Router infers all valid routes from your route tree. Both `Link` and `navigate` enforce valid `to` paths at the type level — typos are compile-time errors.

```tsx
// TypeScript error — '/poasts' does not exist
<Link to="/poasts">Posts</Link>

// Correct
<Link to="/posts">Posts</Link>
```

## JSON-first search params

TanStack Router serializes search params as JSON, not `URLSearchParams`. This means you can store:

- Numbers (not just strings)
- Booleans
- Arrays
- Nested objects

```tsx
<Link
  to="/search"
  search={{
    filters: ['active', 'featured'],
    range: { min: 10, max: 100 },
    page: 3,
  }}
>
  Filtered Search
</Link>
```

## Preloading

Preload route data on hover or viewport entry:

```tsx
<Link to="/posts/$postId" params={{ postId: '123' }} preload="intent">
  View Post
</Link>
```

Options: `'intent'` (hover/touch), `'viewport'` (scroll into view), `'render'` (immediate).

## Rules

- **DO** use `Link` for all navigation — never use `<a href>` for internal routes.
- **DO** use the function form of `search` when merging with existing params.
- **DO** use `redirect()` in loaders/beforeLoad for programmatic redirects.
- **DO** use `preload="intent"` on links to frequently visited pages.
- **DO NOT** use `navigate()` inside render — use `redirect()` in loaders instead.
- **DO NOT** manually construct URL strings — let the router handle serialization.
