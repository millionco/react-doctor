export const REACT_ROUTER_PACKAGE_NAMES: readonly string[] = [
  "@react-router/dev",
  "react-router-dom",
  "react-router",
];

export const REACT_ROUTER_RULE_IDS: readonly string[] = [
  "react-router-csp-nonce-consistency",
  "react-router-descendant-routes-require-splat",
  "react-router-guard-aborted-handle-error",
  "react-router-internal-route-anchor",
  "react-router-loader-fetch-forwards-signal",
  "react-router-loader-parallel-fetch",
  "react-router-nested-route-requires-outlet",
  "react-router-no-catch-middleware-next",
  "react-router-no-client-module-in-server-render",
  "react-router-no-duplicate-route-id",
  "react-router-no-empty-leaf-route",
  "react-router-no-invalid-absolute-child-path",
  "react-router-no-invalid-lazy-route-properties",
  "react-router-no-invalid-splat-path",
  "react-router-no-loader-request-body",
  "react-router-no-middleware-response-body-consumption",
  "react-router-no-multiple-blockers",
  "react-router-no-multiple-middleware-next",
  "react-router-no-multiple-set-search-params-in-tick",
  "react-router-no-navigate-in-render",
  "react-router-no-nested-router",
  "react-router-no-redirect-in-try-catch",
  "react-router-no-route-module-environment-suffix",
  "react-router-no-router-in-render",
  "react-router-no-session-mutation-in-loader",
  "react-router-no-static-cookie-expires",
  "react-router-no-unsynchronized-search-params-mutation",
  "react-router-no-use-loader-data-in-error-ui",
  "react-router-prefer-route-lazy",
  "react-router-require-root-error-boundary",
  "react-router-resource-link-requires-reload",
  "react-router-return-navigation-promise-in-transition",
  "react-router-server-middleware-return-response",
  "react-router-session-mutation-requires-commit",
  "react-router-v8-no-meta-data-field",
  "react-router-v8-no-react-router-dom-import",
  "react-router-v8-no-removed-future-flags",
  "react-router-valid-route-object",
];

export const REACT_ROUTER_RUNTIME_PACKAGE_NAMES = new Set([
  "@react-router/cloudflare",
  "@react-router/node",
  "react-router/dom",
  "react-router-dom",
  "react-router",
]);

export const REACT_ROUTER_SESSION_MUTATOR_NAMES = new Set(["flash", "set", "unset"]);

export const REACT_ROUTER_SESSION_STORAGE_FACTORY_EXPORT_NAMES = new Set([
  "createCookieSessionStorage",
  "createFileSessionStorage",
  "createMemorySessionStorage",
  "createSessionStorage",
  "createWorkersKVSessionStorage",
]);

export const REACT_ROUTER_FACTORY_EXPORT_NAMES = new Set([
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
]);

export const REACT_ROUTER_SEARCH_PARAM_MUTATOR_NAMES = new Set(["append", "delete", "set", "sort"]);

export const REACT_ROUTER_LAZY_FORBIDDEN_PROPERTY_NAMES = new Set([
  "caseSensitive",
  "children",
  "id",
  "index",
  "lazy",
  "path",
]);

export const REACT_ROUTER_SEQUENTIAL_AWAIT_THRESHOLD = 2;

export const REACT_ROUTER_RESPONSE_BODY_READER_NAMES = new Set([
  "arrayBuffer",
  "blob",
  "bytes",
  "formData",
  "json",
  "text",
]);

export const REACT_ROUTER_V8_REMOVED_FUTURE_FLAG_NAMES = new Set([
  "unstable_previewServerPrerendering",
  "v8_middleware",
  "v8_passThroughRequests",
  "v8_splitRouteModules",
  "v8_trailingSlashAwareDataRequests",
  "v8_viteEnvironmentApi",
]);

export const REACT_ROUTER_COMPONENT_ROUTER_EXPORT_NAMES = new Set([
  "BrowserRouter",
  "HashRouter",
  "MemoryRouter",
  "Router",
  "RouterProvider",
]);
