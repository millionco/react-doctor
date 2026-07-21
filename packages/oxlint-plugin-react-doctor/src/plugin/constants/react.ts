import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "./library.js";
import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "./dom.js";

export const INDEX_PARAMETER_NAMES = new Set(["index", "idx", "i"]);

// Module specifiers whose exports are React's own runtime symbols. Effect-event
// rules match `useEffectEvent` by NAME (to stay in parity with
// eslint-plugin-react-hooks, whose fixtures call a bare global), so a same-named
// hook imported from another package — e.g. `@rocket.chat/fuselage-hooks`, whose
// `useEffectEvent` is a stable-callback helper meant to be stored and passed as
// props — is disambiguated by import source before React's semantics apply.
export const REACT_RUNTIME_MODULE_SOURCES = new Set([
  "react",
  "react-dom",
  "preact/compat",
  "preact/hooks",
  "@wordpress/element",
]);

// React-ecosystem packages whose use*-named exports are REAL React hooks
// bound by the Rules of Hooks, even though the package isn't a React
// runtime — state managers, routers, data-fetching libraries. Most of the
// ecosystem self-identifies by carrying "react" in its package name
// (react-redux, @tanstack/react-query, react-hook-form, react-router);
// this set covers the well-known ones that don't. `rules-of-hooks` must
// NOT exempt imports from these the way it exempts non-React use* helpers
// (WebdriverIO's `useBrowser`, DI registries, codegen utilities).
export const REACT_ECOSYSTEM_PACKAGE_NAMES = new Set([
  "next",
  "next-themes",
  "@remix-run/react",
  "swr",
  "zustand",
  "jotai",
  "recoil",
  "wouter",
  "framer-motion",
  "@apollo/client",
  "urql",
  "usehooks-ts",
]);

export const LOADING_STATE_PATTERN = /^(?:isLoading|isPending)$/;

export const STABLE_HOOK_WRAPPERS = new Set(["useState", "useMemo", "useRef"]);

export const GENERIC_EVENT_SUFFIXES = new Set(["Click", "Change", "Input", "Blur", "Focus"]);

export const UNARY_LISTENER_ARGUMENT_COUNT = 1;
export const UNARY_LISTENER_HANDLER_ARGUMENT_INDEX = 0;
export const EVENT_LISTENER_HANDLER_ARGUMENT_INDEX = 1;
export const WHOLE_RECEIVER_RELEASE_ARGUMENT_COUNT = 0;

export const STATE_UPDATER_INITIAL_PROPERTY_WRITE_RANK = 0;
export const STATE_UPDATER_INVOCATION_PROPERTY_WRITE_RANK = 1;
export const STATE_UPDATER_CALL_PROPERTY_WRITE_RANK = 2;

export const TRIVIAL_INITIALIZER_NAMES = new Set([
  "Boolean",
  "String",
  "Number",
  "Array",
  "Object",
  "parseInt",
  "parseFloat",
]);

// Constructing these built-ins WITH NO ARGUMENTS costs about as much
// as calling the trivial coercion functions — `useState(new Date())` /
// `useRef(new Map())` are idiomatic cheap initial values, not the
// expensive-model construction the lazy-init rules target.
// Recommending the lazy-init pattern for an empty container is
// net-negative ceremony. Consumed via
// `utils/is-trivial-built-in-construction.ts` (which also enforces the
// zero-argument, identifier-callee shape) by `rerender-lazy-state-init`
// and `rerender-lazy-ref-init`.
export const TRIVIAL_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Date",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "RegExp",
  "Error",
  "URL",
  "URLSearchParams",
  "AbortController",
]);

// Used by `noDerivedStateEffect` to decide whether a derived-state
// expression is "expensive enough" to recommend `useMemo` over plain
// inline computation. Coercion / parsing / boundary helpers are cheap
// and should still get the "compute during render" message.
// MemberExpression callees (e.g. `Math.floor`, `Date.now`) are
// recognized via BUILTIN_GLOBAL_NAMESPACE_NAMES (the chain root), not
// here — putting "Math" or "Date" in this set wouldn't match because
// the expensive-derivation walker reads the *property* name.
export const TRIVIAL_DERIVATION_CALLEE_NAMES = new Set([
  "Boolean",
  "String",
  "Number",
  "Array",
  "Object",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "BigInt",
  "Symbol",
]);

export const SETTER_PATTERN = /^set[A-Z]/;
export const RENDER_FUNCTION_PATTERN = /^render[A-Z]/;
export const UPPERCASE_PATTERN = /^[A-Z]/;

// React's idiomatic event-handler prop convention — `onClick`, `onChange`,
// `onSearch`, etc. Used by `prefer-use-effect-event` to decide whether a
// destructured prop dep should be treated as function-typed. Without this
// filter the rule false-positives on scalar props that happen to be
// destructured.
export const REACT_HANDLER_PROP_PATTERN = /^on[A-Z]/;

// React's Rules-of-Hooks naming convention — an identifier is a hook when it
// starts with `use` followed by an uppercase letter (`useState`, `useMemo`).
export const HOOK_NAME_PATTERN = /^use[A-Z]/;

// Naming convention for locally declared event-handler functions —
// `handleSubmit`, `onLogin`, etc. Functions named this way are wired
// to events and invoked later, not during render.
export const HANDLER_FUNCTION_NAME_PATTERN = /^(?:on|handle)[A-Z]/;

export const EFFECT_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect"]);
export const HOOKS_WITH_DEPS = new Set(["useEffect", "useLayoutEffect", "useMemo", "useCallback"]);

// React's own built-in hooks — the complement of "custom hook" when a
// callee name already matches the hook naming convention
// (`isReactHookName`). Includes the bare `use(...)` hook from React 19,
// which `isReactHookName` matches by exact name.
export const BUILTIN_HOOK_NAMES: ReadonlySet<string> = new Set([
  "use",
  "useState",
  "useRef",
  "useMemo",
  "useCallback",
  "useReducer",
  "useContext",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useImperativeHandle",
  "useSyncExternalStore",
  "useDeferredValue",
  "useTransition",
  "useId",
  "useDebugValue",
]);

// React's two component-wrapping HOCs that the rule visitor needs to
// "see through" — `memo(Comp)` and `forwardRef(Comp)`. Both forms
// (`memo` from a named import + `React.memo` via the namespace) are
// included so the chain root resolves uniformly regardless of how
// the consumer imports React. Source of truth for the
// `exhaustive-deps`, `rules-of-hooks`, and `no-multi-comp` rule
// detectors which were all maintaining their own identical copy of
// this set.
export const REACT_HOC_NAMES = new Set(["memo", "forwardRef", "React.memo", "React.forwardRef"]);

// Value-memoising hooks whose callback genuinely memoises the
// allocations declared inside it. Shared by the jotai render-body rule
// and the module-scope hoisting rules so they can't disagree about
// which hooks count as "the user already opted into memoisation here".
export const MEMOIZING_HOOK_NAMES = new Set(["useMemo", "useCallback"]);

// Component HOC wrappers the enclosing-component resolver unwraps so
// `const App = memo(() => {})` / `forwardRef((props, ref) => {})` are
// attributed to the `App` binding. Distinct from `REACT_HOC_NAMES`,
// which also carries the dotted `React.memo` forms the deps/hooks
// detectors match against.
export const COMPONENT_HOC_WRAPPER_NAMES = new Set(["memo", "forwardRef", "observer", "lazy"]);

// Subscription-shaped method names recognized by `prefer-use-sync-external-store`.
// Covers the canonical `store.subscribe`, the browser `addEventListener` /
// `addListener`, the EventEmitter `on` / `watch` / `listen`, and shorter
// store APIs like Jotai's `store.sub`. The detector cares only about the
// AST shape (one of these is the property name of a MemberExpression
// callee), never the library that implemented them.
export const SUBSCRIPTION_METHOD_NAMES = new Set([
  "subscribe",
  "addEventListener",
  "addListener",
  "on",
  "watch",
  "listen",
  "sub",
]);

// Subscribe-like methods that return their own disposer. `listen`
// follows the same `const stop = x.listen(cb); return stop` contract
// as `subscribe` (the disposer IS the return value), so returning
// that handle counts as cleanup — but only in the callback-argument
// shape (`is-subscribe-like-call-expression.ts` requires an inline
// function argument, since Node's `server.listen(3000)` returns the
// server, not a disposer). `watch` is deliberately excluded:
// react-hook-form's `form.watch(cb)` returns `{ unsubscribe }` (not
// callable) and `fs.watch` returns an FSWatcher needing `.close()`,
// so a returned watch handle is not a cleanup function.
export const CLEANUP_RETURNING_SUBSCRIPTION_METHOD_NAMES = new Set(["subscribe", "sub", "listen"]);

export const GLOBAL_RELEASE_METHOD_NAMES = new Set([
  "unsubscribe",
  "removeEventListener",
  "removeListener",
  "off",
  "unwatch",
  "unlisten",
  "unsub",
  "abort",
  // Observer (`ResizeObserver` et al.) and connection (`WebSocket` /
  // `EventSource`) release verbs.
  "disconnect",
  "unobserve",
  "close",
]);

export const BOUND_RESOURCE_RELEASE_METHOD_NAMES = new Set([
  "remove",
  "cleanup",
  "dispose",
  "destroy",
  "stop",
  "teardown",
]);

export const CLEANUP_LIKE_RELEASE_CALLEE_NAMES = new Set([
  ...GLOBAL_RELEASE_METHOD_NAMES,
  "cleanup",
  "dispose",
  "destroy",
  "teardown",
]);

// Used by `no-effect-chain` to decide whether an effect is doing
// "real" external-system synchronization (in which case effects on
// either side of the chain are exempt, per the article's own caveat
// about cascading network fetches) versus pure internal reactivity
// (which is the anti-pattern). A cleanup return is the strongest
// signal; the curated method list covers the rest.
//
// Member-method names that, on their own, mark a call as external
// sync regardless of receiver. These are unambiguous in real React
// codebases — they don't clash with built-in JS APIs.
//
// Layered on top of `SUBSCRIPTION_METHOD_NAMES` so the subscribe-shape
// detector and the external-sync detector can never disagree about
// which method names are "subscriptions."
export const EXTERNAL_SYNC_MEMBER_METHOD_NAMES = new Set([
  ...SUBSCRIPTION_METHOD_NAMES,
  // Imperative widget lifecycle (createConnection().connect()/.disconnect())
  "connect",
  "disconnect",
  "open",
  "close",
  // Mutating HTTP verbs — `*.post(url, body)` is essentially always
  // a network call. (`delete` is moved to the ambiguous set below
  // because Map / Set / URLSearchParams / Headers / FormData /
  // WeakMap all expose `.delete(...)` as a built-in method.)
  "fetch",
  "post",
  "put",
  "patch",
]);

// HACK: `get`, `head`, `options` are HTTP verbs but ALSO names of
// universal data-structure methods (`Map.get`, `URLSearchParams.get`,
// `FormData.get`, `Headers.get`, `WeakMap.get`, `Set.has`, etc.). We
// only treat them as external-sync calls when the receiver is a
// recognized HTTP-client-shaped name. Lets the `axios.get(...)`
// cascade case work without false-classifying `params.get('id')` as
// external sync.
//
// Layered on top of `FETCH_MEMBER_OBJECTS` (the canonical HTTP-client
// receiver list used by `containsFetchCall`) so adding a new client
// name in one place propagates to both detectors.
export const EXTERNAL_SYNC_HTTP_CLIENT_RECEIVERS = new Set([
  ...FETCH_MEMBER_OBJECTS,
  "api",
  "client",
  "http",
  "fetcher",
]);

export const EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES = new Set([
  "get",
  "head",
  "options",
  "delete",
]);

// Direct callees that mark an effect body as external-sync. Combines
// the shared HTTP-client direct-callee list (`FETCH_CALLEE_NAMES`)
// with the timer / scheduler list above so all three rule families
// share a single source of truth for these names.
export const EXTERNAL_SYNC_DIRECT_CALLEE_NAMES = new Set([
  ...FETCH_CALLEE_NAMES,
  ...TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES,
]);

// Used by `no-event-trigger-state` to recognize when a useEffect body
// is performing the §6 anti-pattern from "You Might Not Need an Effect"
// — running an event-shaped side effect (POST, navigation, notification,
// analytics) that the user actually triggered with a button click.
// Tightly scoped on purpose — adding a callee name here can produce
// false positives on pure helper functions, so the bar is "this name
// almost always denotes a fire-and-forget user-action effect."
// Layered on top of `FETCH_CALLEE_NAMES` so adding a new HTTP client
// shorthand in one place propagates to every detector that recognizes it.
//
// HACK: ambiguous generic verbs (`track`, `logEvent`, `del`) used to
// live here too. They produced FPs on user-defined helpers
// (`track(progress)`, `del(item)`) that have nothing to do with
// network/analytics side effects. Detection still works via the
// receiver-bound member-call shape (`analytics.track(...)`,
// `api.del(...)`) in `EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS`.
//
// `post` / `put` / `patch` are KEPT here — the canonical "You Might
// Not Need an Effect" §6 example is `post(jsonToSubmit)` as a bare
// callee, so removing them would silently miss the textbook case.
// The trade-off (FPs on user helpers named `post(...)`) is acceptable
// at this scope.
export const EVENT_TRIGGERED_SIDE_EFFECT_CALLEES = new Set([
  ...FETCH_CALLEE_NAMES,
  // Network shorthand verbs (article uses `post`)
  "post",
  "put",
  "patch",
  // Navigation
  "navigate",
  "navigateTo",
  // UI side effects
  "showNotification",
  "toast",
  "alert",
  "confirm",
  // Analytics
  "logVisit",
  "captureEvent",
]);

// Recognized when the call shape is `<obj>.<method>(...)` — covers
// `axios.post`, `api.post`, `analytics.track`, `posthog.capture`,
// etc. without enumerating every possible object. Names here are
// unambiguous: they don't clash with built-in JS prototype methods
// or common application code.
export const EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS = new Set([
  "post",
  "put",
  "patch",
  "delete",
  "navigate",
  "capture",
  "track",
  "logEvent",
]);

// HACK: `push` and `replace` are router methods (`router.push("/foo")`,
// `history.replace("/bar")`) but ALSO universal Array / String prototype
// methods. `[1, 2].push(3)` and `"a".replace("b", "c")` are NOT event-
// shaped side effects — calling `setX` after them in a useEffect is
// usually fine. We only treat them as event-triggered side effects when
// the receiver looks router-shaped. Keeps the false-positive rate down
// without losing the `router.push(...)` / `history.replace(...)` cases.
export const EVENT_TRIGGERED_NAVIGATION_METHOD_NAMES = new Set(["push", "replace"]);

export const NAVIGATION_RECEIVER_NAMES = new Set([
  "router",
  "navigation",
  "navigator",
  "history",
  "location",
]);
