import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "./library.js";
import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "./dom.js";

export const INDEX_PARAMETER_NAMES = new Set(["index", "idx", "i"]);

export const LOADING_STATE_PATTERN = /^(?:isLoading|isPending)$/;

export const STABLE_HOOK_WRAPPERS = new Set(["useState", "useMemo", "useRef"]);

export const GENERIC_EVENT_SUFFIXES = new Set(["Click", "Change", "Input", "Blur", "Focus"]);

export const TRIVIAL_INITIALIZER_NAMES = new Set([
  "Boolean",
  "String",
  "Number",
  "Array",
  "Object",
  "parseInt",
  "parseFloat",
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

export const EFFECT_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect"]);
export const HOOKS_WITH_DEPS = new Set(["useEffect", "useLayoutEffect", "useMemo", "useCallback"]);

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

// Methods that pair with the subscription methods above as their cleanup
// counterparts. Used to recognize a valid `return () => removeEventListener(...)`
// cleanup form even when the subscribe call is `addEventListener` rather
// than a `subscribe()` whose return value gets re-bound.
export const UNSUBSCRIPTION_METHOD_NAMES = new Set([
  "unsubscribe",
  "removeEventListener",
  "removeListener",
  "off",
  "unwatch",
  "unlisten",
  "unsub",
]);

// Identifier names recognized as "this is a release/teardown call"
// when they appear as a direct call inside an effect's cleanup
// return — covers both library unsubscribe shorthands
// (UNSUBSCRIPTION_METHOD_NAMES) and the generic teardown vocabulary
// (`cleanup`, `dispose`, `destroy`, `teardown`). Matched
// case-insensitively at the call site.
export const CLEANUP_LIKE_RELEASE_CALLEE_NAMES = new Set([
  ...UNSUBSCRIPTION_METHOD_NAMES,
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
