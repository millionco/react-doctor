---
"oxlint-plugin-react-doctor": minor
---

Add `no-prop-drilling` (Architecture / Maintainability): flags a prop forwarded untouched through 3+ same-file components — each a pure pass-through that never reads it — before it's finally used, and recommends lifting the value into a Context/Provider (or composing with `children`). The detector is scope-aware: it resolves each JSX tag to a same-file component and each forwarded attribute value to a prop parameter binding, so shadowed names, transformed values (`user.name`, `fn(user)`), conditionals, `{...spread}`, and hand-offs to DOM or imported components don't count as untouched forwarding. Sourced from the vercel-labs `composition-patterns` (compound-components) skill.
