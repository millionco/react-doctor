# Document Head & SEO

TanStack Start manages `<head>` tags through the `head` route property and the `<HeadContent />` component. No external library needed.

## Setup

Render `<HeadContent />` in your root route's `<head>`:

```tsx
// routes/__root.tsx
import { createRootRoute, Outlet, HeadContent, Scripts } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
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

## Static meta tags

```tsx
export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [
      { title: 'About Us — My App' },
      { name: 'description', content: 'Learn more about our team and mission.' },
    ],
  }),
  component: AboutPage,
})
```

## Dynamic meta tags from loader data

Access `loaderData` inside the `head` function:

```tsx
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => {
    const post = await fetchPost(params.postId)
    return { post }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData.post.title },
      { name: 'description', content: loaderData.post.excerpt },
    ],
  }),
  component: PostPage,
})
```

## Open Graph and social sharing

```tsx
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => fetchPost(params.postId),
  head: ({ loaderData, params }) => ({
    meta: [
      { title: loaderData.title },
      { name: 'description', content: loaderData.excerpt },
      { property: 'og:title', content: loaderData.title },
      { property: 'og:description', content: loaderData.excerpt },
      { property: 'og:image', content: loaderData.coverImage },
      { property: 'og:type', content: 'article' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: loaderData.title },
      { name: 'twitter:description', content: loaderData.excerpt },
      { name: 'twitter:image', content: loaderData.coverImage },
    ],
    links: [
      { rel: 'canonical', href: `https://myapp.com/posts/${params.postId}` },
    ],
  }),
  component: PostPage,
})
```

## Deduplication

TanStack Router automatically deduplicates `title` and `meta` tags. Nested routes override parent routes — the deepest matched route wins for any given tag.

## Structured data (JSON-LD)

Use the `scripts` property for structured data:

```tsx
export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => fetchPost(params.postId),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData.title }],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: loaderData.title,
          description: loaderData.excerpt,
        }),
      },
    ],
  }),
  component: PostPage,
})
```

## Rules

- **DO** always render `<HeadContent />` in `__root.tsx` inside `<head>`.
- **DO** set base meta tags (charset, viewport) in the root route's `head`.
- **DO** use `head` with `loaderData` for dynamic pages — not `useEffect` with `document.title`.
- **DO** include Open Graph and Twitter Card tags for shareable pages.
- **DO** add canonical URLs to prevent duplicate content issues.
- **DO NOT** forget `<Scripts />` before closing `</body>` — hydration depends on it.
