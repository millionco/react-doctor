---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Fix trust-breaking false positives in `nextjs-no-side-effect-in-get-handler`
(issue #206). The rule used to flag any `<member>.<set|append|delete|create|
insert|update|upsert|remove|destroy>()` call as a server-state mutation,
which flooded one Next.js 14 codebase with 138 false errors — every single
one a `response.headers.set(...)` response-shaping call.

The rule now skips these shapes, all of which only shape the outbound
response or mutate request-scoped collections:

- `response.headers.set/append/delete(...)` and any chain ending in
  `.headers` (e.g. `NextResponse.json({...}).headers.set(...)`,
  `(await fetcher()).headers.append(...)`).
- Locally-constructed `new Map/Set/WeakMap/WeakSet/Headers/URLSearchParams/
FormData/Response/NextResponse(...)` bindings and any mutation on those
  aliases.
- `new URL(...).searchParams.set(...)` and any `.searchParams.*()` chain.
- `headers()` / `(await headers())` from `next/headers` (returns
  `ReadonlyHeaders`; any mutation would throw at runtime) and any aliased
  `const h = headers(); h.get(...)`.
- Route handlers under `/cron/` or `/jobs/cron/` — Vercel Cron always
  invokes GET and is expected to do real work.

The rule still flags real CSRF-relevant side effects:

- ORM mutations like drizzle `db.update(table).set({...})`, `prisma.user.
create(...)`, `db.insert(...)`, `repository.upsert(...)`.
- Module-level mutable state (`const cache = new Map()` declared outside
  the handler, then `cache.set(...)` inside it).
- `fetch(url, { method: "POST" | "PUT" | "DELETE" | "PATCH" })`.
- `cookies().set/append/delete()` in all forms: direct, `(await cookies()).
set(...)`, and aliased `const cookieStore = await cookies(); cookieStore.
set(...)` — the alias resolution now flags previously-missed handlers.
- Mutating route segments (`/logout`, `/signout`, `/unsubscribe`, `/delete`,
  …).

The rule also gained depth-bounded handler-binding resolution so
`export const GET = withAuth(handler)` and `export const GET = app.get('/x',
handler).get('/y', handler)` get scanned correctly.

Closes #206. Supersedes PRs #209, #211, #233, and #238.
