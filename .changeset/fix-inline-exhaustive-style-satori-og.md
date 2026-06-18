---
"oxlint-plugin-react-doctor": patch
---

Stop `no-inline-exhaustive-style` from flagging Satori (next/og, @vercel/og) OG-image components.

OG components style everything inline because Satori rasterizes the JSX to a static image and supports no other styling channel — so the rule's "rebuilds every render" premise never applies, and an exhaustive `style={{…}}` is the only way to lay them out. The rule now shares the same `isGeneratedImageRenderContext` guard the sibling image rules already use (`alt-text`, `nextjs-no-img-element`, `no-unknown-property`): it short-circuits in Next.js metadata image routes (`opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, …) and skips JSX that flows into an `ImageResponse(...)`/`satori(...)` call, including a helper component resolved to that call. The expensive per-node generated-image lookup runs only once a style is large enough to report, so ordinary files pay nothing. Exhaustive inline styles in regular components are still flagged.
