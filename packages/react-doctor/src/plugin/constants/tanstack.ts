export const TANSTACK_ROUTE_FILE_PATTERN = /\/routes\//;
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

export const TANSTACK_ROUTE_CREATION_FUNCTIONS = new Set([
  "createFileRoute",
  "createRoute",
  "createRootRoute",
  "createRootRouteWithContext",
]);

export const TANSTACK_SERVER_FN_NAMES = new Set(["createServerFn"]);

export const TANSTACK_MIDDLEWARE_METHOD_ORDER = [
  "middleware",
  "inputValidator",
  "client",
  "server",
  "handler",
];

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
