---
"oxlint-plugin-react-doctor": patch
---

Stop flagging `only-export-components` on framework route modules (#758).

TanStack Router file routes (`export const Route = createFileRoute(...)({ component: ProfilePage })`) were reported even though the router's bundler plugin owns HMR for those modules. Route-factory exports (`createFileRoute`, `createLazyFileRoute`, `createRootRoute`, `createRootRouteWithContext`, data routers like `createBrowserRouter`, …) now count as component exports, and framework route-module contract exports (Remix / React Router `loader` / `action` / `meta` / …, Next.js Pages Router `getServerSideProps` / `getStaticProps` / …, App Router segment config, Expo Router `unstable_settings`) are allowed alongside components.
