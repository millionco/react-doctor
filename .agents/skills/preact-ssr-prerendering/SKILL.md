---
name: preact-ssr-prerendering
description: "Use when implementing Preact SSR, preact-render-to-string, renderToStringAsync, streams, preact-iso prerendering, route hydration, or Suspense/lazy with server-rendered markup."
---

# Preact SSR and Prerendering

SSR output is only safe when the server render, browser parser, and first client render agree.

## Renderer Choice

- **`renderToString()`** — synchronous full HTML strings.
- **`renderToStringAsync()`** — lazy components or data promises must resolve before returning the full string.
- **`renderToPipeableStream()`** — Node streams.
- **`renderToReadableStream()`** — Web Streams.
- **`preact-iso` `prerender()`** — route-aware static output with link discovery.

All live in `preact-render-to-string` or `preact-iso`.

## Minimal Node Example

```js
// server.js
import { renderToString } from 'preact-render-to-string';
import { App } from './app.js';

export function handler(req, res) {
  const html = renderToString(<App url={req.url} />);
  res.end(`<!doctype html><div id="app">${html}</div><script type="module" src="/client.js"></script>`);
}
```

```js
// client.js
import { hydrate } from 'preact';
import { App } from './app.js';
hydrate(<App url={location.pathname} />, document.getElementById('app'));
```

## Hydration Contract

- Hydrate the same route tree and data shape that produced the HTML.
- Import aliases and JSX runtime must be identical between server and browser.
- Avoid client-only branching on the first render. Defer browser-only DOM to an effect or render a matching placeholder (see [preact-hydration-mismatches](../preact-hydration-mismatches/SKILL.md)).
- On Preact v10, avoid async/lazy boundaries that resolve to zero nodes or multiple sibling nodes during resumed hydration — wrap them in one stable element.

## Tests

Use browser tests for hydration and Suspense. Assert `root.innerHTML` before hydration, after hydration, and after lazy promise resolution. Include invalid-nesting and form-control cases when SSR markup comes from strings, since browser parsers silently rewrite them.

Doc anchors: [Server-Side Rendering](https://preactjs.com/guide/v10/server-side-rendering), [preact-render-to-string](https://github.com/preactjs/preact-render-to-string), [preact-iso](https://github.com/preactjs/preact-iso).
