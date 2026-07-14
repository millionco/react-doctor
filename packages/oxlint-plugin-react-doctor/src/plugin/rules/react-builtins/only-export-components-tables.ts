// Data tables consumed by the `only-export-components` Fast Refresh
// rule. Extracted so the rule file can stay focused on the AST
// analysis logic; behaviour-neutral.

import { TANSTACK_ROUTE_CREATION_FUNCTIONS } from "../../constants/tanstack.js";

export const NOT_REACT_COMPONENT_EXPRESSION_TYPES: ReadonlySet<string> = new Set([
  "ArrayExpression",
  "AwaitExpression",
  "BinaryExpression",
  "ChainExpression",
  "ConditionalExpression",
  "Literal",
  "LogicalExpression",
  "NewExpression",
  "ObjectExpression",
  "TemplateLiteral",
  "ThisExpression",
  "UnaryExpression",
  "UpdateExpression",
]);

// Directory names that mark a file as outside the Fast Refresh
// surface — tests, fixtures, mocks, Cypress specs, Storybook MDX,
// playground / demo / example apps that aren't dev-server-hosted, etc.
// We match these as path segments so a project component file named
// `tests-page.tsx` (no slash) still gets checked.
export const NON_FAST_REFRESH_PATH_SEGMENTS: ReadonlyArray<string> = [
  "/test/",
  "/tests/",
  "/__tests__/",
  "/__test__/",
  "/__fixtures__/",
  "/fixtures/",
  "/__mocks__/",
  "/mocks/",
  "/cypress/",
  "/.storybook/",
  "/stories/",
  "/__stories__/",
];

// Route-object factory callees from file-based routers. A call like
// `createFileRoute("/profile")({ component: ProfilePage })` produces
// the route export the router's bundler plugin handles with its own
// HMR integration — exporting it alongside (or referencing) a local
// component is the documented convention, not a Fast Refresh hazard.
// Covers TanStack Router / TanStack Start (`createFileRoute`,
// `createLazyFileRoute`, `createRootRoute`, …) and `createBrowserRouter`
// / `createHashRouter` / `createMemoryRouter` style data routers.
export const TANSTACK_ROUTE_FACTORY_CALLEE_NAMES: ReadonlySet<string> = new Set([
  ...TANSTACK_ROUTE_CREATION_FUNCTIONS,
  "createLazyFileRoute",
  "createLazyRoute",
  "createAPIFileRoute",
  "createServerFileRoute",
  "createServerRootRoute",
  "createServerRoute",
]);

export const REACT_ROUTER_FACTORY_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
  "createStaticRouter",
  "createRouter",
]);

// Framework route-module export names. Remix / React Router route
// modules and Next.js Pages Router pages co-export these alongside the
// route component by framework contract; the bundler plugins for those
// frameworks special-case them during Fast Refresh.
export const REACT_ROUTER_ALLOWED_EXPORT_NAMES: ReadonlySet<string> = new Set([
  // Remix / React Router route module exports
  "loader",
  "clientLoader",
  "action",
  "clientAction",
  "headers",
  "meta",
  "links",
  "handle",
  "shouldRevalidate",
  "middleware",
  "unstable_middleware",
]);

export const NEXT_ALLOWED_EXPORT_NAMES: ReadonlySet<string> = new Set([
  "getServerSideProps",
  "getStaticProps",
  "getStaticPaths",
  "getInitialProps",
  "reportWebVitals",
  // Next.js App Router route segment config / metadata exports
  "metadata",
  "generateMetadata",
  "generateStaticParams",
  "generateImageMetadata",
  "generateSitemaps",
  "viewport",
  "generateViewport",
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "experimental_ppr",
]);

export const EXPO_ALLOWED_EXPORT_NAMES: ReadonlySet<string> = new Set(["unstable_settings"]);
