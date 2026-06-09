Implement the App Router route handler in `app/api/products/route.ts`.

## Expected behavior

Handle `GET /api/products`, optionally filtered by a max price.

- The catalog is the `PRODUCTS` array exported from `src/products.ts`.
- Read the `maxPriceCents` query parameter from the request URL.
  - When absent, return the full catalog.
  - When present, return only products whose `priceCents` is **less than or
    equal to** that value.
- Respond with the resulting array as JSON and status `200`.

Examples (status `200` in all cases):

- `GET /api/products` → all of `PRODUCTS`.
- `GET /api/products?maxPriceCents=300` → `[{ Pen, 250 }, { Eraser, 99 }]`
  (the products priced at or below 300).

## Constraints

Export the handler as a named `GET` function taking the `Request`
(App Router route-handler convention). Do not change `src/products.ts`.
