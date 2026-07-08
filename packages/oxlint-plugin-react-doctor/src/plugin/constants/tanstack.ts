export const TANSTACK_ROOT_ROUTE_FILE_PATTERN = /__root\.(tsx?|jsx?)$/;

export const TANSTACK_ROUTE_PROPERTY_ORDER = [
  "params",
  "validateSearch",
  "loaderDeps",
  "search.middlewares",
  "ssr",
  "context",
  "beforeLoad",
  "loader",
  "onEnter",
  "onStay",
  "onLeave",
  "head",
  "scripts",
  "headers",
  "remountDeps",
];

// Index of each order-sensitive route property, so membership and ordering
// are one Map lookup instead of includes() + indexOf() linear scans.
export const TANSTACK_ROUTE_PROPERTY_INDEX: ReadonlyMap<string, number> = new Map(
  TANSTACK_ROUTE_PROPERTY_ORDER.map((propertyName, orderIndex) => [propertyName, orderIndex]),
);

export const TANSTACK_ROUTE_CREATION_FUNCTIONS = new Set([
  "createFileRoute",
  "createRoute",
  "createRootRoute",
  "createRootRouteWithContext",
]);

export const TANSTACK_SERVER_FN_NAMES = new Set(["createServerFn"]);

// `validator` is the current server-fn input-validation method; `inputValidator`
// is the deprecated alias kept for older `@tanstack/react-start` versions.
export const TANSTACK_INPUT_VALIDATOR_METHOD_NAMES = new Set(["validator", "inputValidator"]);

export const TANSTACK_MIDDLEWARE_METHOD_ORDER = [
  "middleware",
  "validator",
  "client",
  "server",
  "handler",
];

// Same Map-index companion for the server-fn middleware chain order.
export const TANSTACK_MIDDLEWARE_METHOD_INDEX: ReadonlyMap<string, number> = new Map(
  TANSTACK_MIDDLEWARE_METHOD_ORDER.map((methodName, orderIndex) => [methodName, orderIndex]),
);

export const TANSTACK_REDIRECT_FUNCTIONS = new Set(["redirect", "notFound"]);

export const TANSTACK_SERVER_FN_FILE_PATTERN = /\.functions(\.[jt]sx?)?$/;

export const SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER = 2;

export const TANSTACK_QUERY_HOOKS = new Set([
  "useQuery",
  "useInfiniteQuery",
  "useSuspenseQuery",
  "useSuspenseInfiniteQuery",
]);

export const TANSTACK_MUTATION_HOOKS = new Set(["useMutation"]);

export const TANSTACK_QUERY_CLIENT_CLASS = "QueryClient";

// Every queryClient method that legitimately keeps the cache in sync
// after a mutation. `query-mutation-missing-invalidation` looks for ANY
// of these inside `onSuccess` (etc.); flagging only `invalidateQueries`
// produced false positives on `setQueryData`, `resetQueries`, and so on.
export const QUERY_CACHE_UPDATE_METHODS = new Set([
  "invalidateQueries",
  "setQueryData",
  "setQueriesData",
  "resetQueries",
  "refetchQueries",
  "removeQueries",
  "cancelQueries",
  "clear",
]);

// tRPC's react-query integration invalidates through its own proxy
// (`utils.posts.invalidate()`), which wraps queryClient.invalidateQueries.
// `invalidate` is a far more generic verb than the queryClient method names
// above (`session.invalidate()` is a stale-cache true positive), so it only
// counts when the receiver chain is rooted in a binding created by one of
// these hooks.
// Any TanStack Query entry point (`@tanstack/react-query`,
// `@tanstack/query-core`, `@tanstack/vue-query`, devtools subpaths, …).
// An import matching this proves a file's `useMutation` / `useQuery`
// call really is TanStack's, not a same-named export from another
// library.
export const TANSTACK_QUERY_MODULE_PATTERN = /^@tanstack\/[^/]*query/;

export const TRPC_UTILS_INVALIDATE_METHOD = "invalidate";
export const TRPC_UTILS_HOOK_PATTERN = /^use\w*Utils$/;
export const QUERY_CLIENT_HOOK_NAME = "useQueryClient";
