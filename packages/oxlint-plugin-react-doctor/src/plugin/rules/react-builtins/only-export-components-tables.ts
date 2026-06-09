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
  "/playground/",
  "/playgrounds/",
  "/examples/",
  "/example/",
  "/demo/",
  "/demos/",
  "/sandbox/",
  "/sandboxes/",
];

// File basenames that conventionally are application entry points —
// they call `createRoot(...).render(...)` / `hydrateRoot(...)` /
// `ReactDOM.render(...)` once and never participate in Fast Refresh
// (the dev server reloads the whole page when these change). Mixed
// exports and local components in these files are fine.
export const ENTRY_POINT_BASENAMES: ReadonlySet<string> = new Set([
  "main.tsx",
  "main.jsx",
  "main.js",
  "index.tsx",
  "index.jsx",
  "entry.tsx",
  "entry.jsx",
  "bootstrap.tsx",
  "bootstrap.jsx",
  "client.tsx",
  "client.jsx",
  "server.tsx",
  "server.jsx",
  // Next.js App Router page boundaries — re-rendered on full reload,
  // commonly co-export `metadata`, `generateMetadata`, `revalidate`,
  // etc. alongside the page component.
  "page.tsx",
  "page.jsx",
  "layout.tsx",
  "layout.jsx",
  "loading.tsx",
  "loading.jsx",
  "error.tsx",
  "error.jsx",
  "not-found.tsx",
  "not-found.jsx",
  "template.tsx",
  "template.jsx",
  "default.tsx",
  "default.jsx",
  "global-error.tsx",
  "global-error.jsx",
  "route.tsx",
  "route.jsx",
  // Expo Router layout files — same role as Next.js `layout.tsx` but
  // prefixed with `_` per Expo Router convention.
  "_layout.tsx",
  "_layout.jsx",
  // Next.js Pages Router special files
  "_app.tsx",
  "_app.jsx",
  "_document.tsx",
  "_document.jsx",
  "_error.tsx",
  "_error.jsx",
  // Root App component — by convention the single-render root of a CRA
  // / Vite / Expo app, mounted directly from main/index. Co-exports of
  // helper components and constants are conventional here.
  "app.tsx",
  "app.jsx",
  "App.tsx",
  "App.jsx",
]);

// Utility / helper / shared-config / column-renderer / node-registry
// files. These conventionally hold a mix of component-style and
// constant exports — `utils.tsx` for a slice that contains both a
// render helper component and string-formatting constants, `shared.tsx`
// for cross-component types and helpers, `nodeTypes.tsx` for an
// xyflow / tldraw / lexical node registry that maps strings to node
// renderer components, `*ColumnRenderers.tsx` for table column-renderer
// collections, `*useCreate*.tsx` hooks that co-export helper constants.
// These NEVER get edited live (the dev would Cmd+R anyway), so Fast
// Refresh preservation isn't an actual gain — the file structure is by
// design. Pattern requires the EXACT basename match (no fuzzy match)
// so unrelated files (`MyUtils.tsx`, `userUtils.tsx`) only match when
// the basename IS that.
export const UTILITY_FILE_BASENAMES: ReadonlySet<string> = new Set([
  // Generic utility/helper bags
  "utils.tsx",
  "utils.jsx",
  "util.tsx",
  "util.jsx",
  "helpers.tsx",
  "helpers.jsx",
  "helper.tsx",
  "helper.jsx",
  "shared.tsx",
  "shared.jsx",
  "common.tsx",
  "common.jsx",
  "lib.tsx",
  "lib.jsx",
  // Node-type / cell-type / column-renderer registries
  "nodeTypes.tsx",
  "nodeTypes.jsx",
  "node-types.tsx",
  "node-types.jsx",
  "edgeTypes.tsx",
  "edgeTypes.jsx",
  "edge-types.tsx",
  "edge-types.jsx",
  "cellTypes.tsx",
  "cellTypes.jsx",
  "columnTypes.tsx",
  "columnTypes.jsx",
  "columnDefs.tsx",
  "columnDefs.jsx",
  "columnRenderers.tsx",
  "columnRenderers.jsx",
  "columns.tsx",
  "columns.jsx",
  // Mappings / dictionaries / lookups
  "mappings.tsx",
  "mappings.jsx",
  "mapping.tsx",
  "mapping.jsx",
  "lookups.tsx",
  "lookups.jsx",
  "lookup.tsx",
  "lookup.jsx",
  "registry.tsx",
  "registry.jsx",
  // Toast / notification helper file (typically combines provider + helper functions)
  "toast.tsx",
  "toast.jsx",
  "toaster.tsx",
  "toaster.jsx",
  // Theme / token / palette utility files
  "theme.tsx",
  "theme.jsx",
  "tokens.tsx",
  "tokens.jsx",
  "palette.tsx",
  "palette.jsx",
  "colors.tsx",
  "colors.jsx",
  "colours.tsx",
  "colours.jsx",
  // Constants / enums / type helpers (.tsx variant for component types)
  "constants.tsx",
  "constants.jsx",
  "enums.tsx",
  "enums.jsx",
  "types.tsx",
  "types.jsx",
  "schemas.tsx",
  "schemas.jsx",
  "schema.tsx",
  "schema.jsx",
  // Definition / config files
  "definitions.tsx",
  "definitions.jsx",
  "config.tsx",
  "config.jsx",
  "defaults.tsx",
  "defaults.jsx",
]);

// Route-object factory callees from file-based routers. A call like
// `createFileRoute("/profile")({ component: ProfilePage })` produces
// the route export the router's bundler plugin handles with its own
// HMR integration — exporting it alongside (or referencing) a local
// component is the documented convention, not a Fast Refresh hazard.
// Covers TanStack Router / TanStack Start (`createFileRoute`,
// `createLazyFileRoute`, `createRootRoute`, …) and `createBrowserRouter`
// / `createHashRouter` / `createMemoryRouter` style data routers.
export const ROUTE_FACTORY_CALLEE_NAMES: ReadonlySet<string> = new Set([
  ...TANSTACK_ROUTE_CREATION_FUNCTIONS,
  "createLazyFileRoute",
  "createLazyRoute",
  "createAPIFileRoute",
  "createServerFileRoute",
  "createServerRootRoute",
  "createServerRoute",
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
export const ROUTE_MODULE_ALLOWED_EXPORT_NAMES: ReadonlySet<string> = new Set([
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
  // Next.js Pages Router data exports
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
  // Expo Router route settings export
  "unstable_settings",
]);
