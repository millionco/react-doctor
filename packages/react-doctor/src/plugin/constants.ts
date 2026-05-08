export const GIANT_COMPONENT_LINE_THRESHOLD = 300;
export const CASCADING_SET_STATE_THRESHOLD = 3;
export const RELATED_USE_STATE_THRESHOLD = 5;
export const DEEP_NESTING_THRESHOLD = 3;
export const DUPLICATE_STORAGE_READ_THRESHOLD = 2;
export const SEQUENTIAL_AWAIT_THRESHOLD = 3;
export const PROPERTY_ACCESS_REPEAT_THRESHOLD = 3;
export const BOOLEAN_PROP_THRESHOLD = 4;
export const RENDER_PROP_PROLIFERATION_THRESHOLD = 3;
// Real-world API keys, tokens, and credentials are 24+ chars. 8 chars produced
// many false positives on UI strings ("loading...", short captions, etc.).
export const SECRET_MIN_LENGTH_CHARS = 24;
export const AUTH_CHECK_LOOKAHEAD_STATEMENTS = 10;

export const LAYOUT_PROPERTIES = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "borderWidth",
  "fontSize",
  "lineHeight",
  "gap",
]);

export const MOTION_ANIMATE_PROPS = new Set([
  "animate",
  "initial",
  "exit",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileDrag",
  "whileInView",
]);

export const HEAVY_LIBRARIES = new Set([
  "@monaco-editor/react",
  "monaco-editor",
  "recharts",
  "@react-pdf/renderer",
  "react-quill",
  "@codemirror/view",
  "@codemirror/state",
  "chart.js",
  "react-chartjs-2",
  "@toast-ui/editor",
  "draft-js",
]);

export const FETCH_CALLEE_NAMES = new Set(["fetch", "ky", "got", "wretch", "ofetch"]);
export const FETCH_MEMBER_OBJECTS = new Set(["axios", "ky", "got", "ofetch", "wretch", "request"]);
export const INDEX_PARAMETER_NAMES = new Set(["index", "idx", "i"]);
export const BARREL_INDEX_SUFFIXES = [
  "/index",
  "/index.js",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
];
export const PASSIVE_EVENT_NAMES = new Set([
  "scroll",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
]);

export const LOOP_TYPES = [
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
];

export const AUTH_FUNCTION_NAMES = new Set([
  "auth",
  "getSession",
  "getServerSession",
  "getUser",
  "requireAuth",
  "checkAuth",
  "verifyAuth",
  "authenticate",
  "currentUser",
  "getAuth",
  "validateSession",
]);

export const SECRET_PATTERNS = [
  /^sk_live_/,
  /^sk_test_/,
  /^AKIA[0-9A-Z]{16}$/,
  /^ghp_[a-zA-Z0-9]{36}$/,
  /^gho_[a-zA-Z0-9]{36}$/,
  /^github_pat_/,
  /^glpat-/,
  /^xox[bporas]-/,
  /^sk-[a-zA-Z0-9]{32,}$/,
];

export const SECRET_VARIABLE_PATTERN = /(?:api_?key|secret|token|password|credential|auth)/i;

export const SECRET_FALSE_POSITIVE_SUFFIXES = new Set([
  "modal",
  "label",
  "text",
  "title",
  "name",
  "id",
  "key",
  "url",
  "path",
  "route",
  "page",
  "param",
  "field",
  "column",
  "header",
  "placeholder",
  "description",
  "type",
  "icon",
  "class",
  "style",
  "variant",
  "event",
  "action",
  "status",
  "state",
  "mode",
  "flag",
  "option",
  "config",
  "message",
  "error",
  "display",
  "view",
  "component",
  "element",
  "container",
  "wrapper",
  "button",
  "link",
  "input",
  "select",
  "dialog",
  "menu",
  "form",
  "step",
  "index",
  "count",
  "length",
  "role",
  "scope",
  "context",
  "provider",
  "ref",
  "handler",
  "query",
  "schema",
  "constant",
]);

export const LOADING_STATE_PATTERN = /^(?:isLoading|isPending)$/;

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

export const STABLE_HOOK_WRAPPERS = new Set(["useState", "useMemo", "useRef"]);

export const SCRIPT_LOADING_ATTRIBUTES = new Set(["defer", "async"]);

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

// Built-in JS globals whose method calls (`Math.floor(x)`,
// `Date.now()`, `JSON.parse(x)`, …) are not reactive reads and don't
// count as "expensive derivations". The chain root is what matters —
// `Math.floor(raw)` should only treat `raw` as a reactive read, and
// the call itself should be classified as trivial regardless of which
// method is invoked.
export const BUILTIN_GLOBAL_NAMESPACE_NAMES = new Set([
  "Math",
  "Date",
  "JSON",
  "Object",
  "Array",
  "Number",
  "String",
  "Boolean",
  "RegExp",
  "Symbol",
  "BigInt",
  "Reflect",
]);

export const SETTER_PATTERN = /^set[A-Z]/;
export const RENDER_FUNCTION_PATTERN = /^render[A-Z]/;
export const UPPERCASE_PATTERN = /^[A-Z]/;
export const PAGE_FILE_PATTERN = /\/page\.(tsx?|jsx?)$/;

// React's idiomatic event-handler prop convention — `onClick`, `onChange`,
// `onSearch`, etc. Used by `prefer-use-effect-event` to decide whether a
// destructured prop dep should be treated as function-typed. Without this
// filter the rule false-positives on scalar props that happen to be
// destructured.
export const REACT_HANDLER_PROP_PATTERN = /^on[A-Z]/;
export const PAGE_OR_LAYOUT_FILE_PATTERN = /\/(page|layout)\.(tsx?|jsx?)$/;

export const INTERNAL_PAGE_PATH_PATTERN =
  /\/(?:(?:\((?:dashboard|admin|settings|account|internal|manage|console|portal|auth|onboarding|app|ee|protected)\))|(?:dashboard|admin|settings|account|internal|manage|console|portal))\//i;

export const TEST_FILE_PATTERN = /\.(?:test|spec|stories)\.[tj]sx?$/;
export const OG_ROUTE_PATTERN = /\/og\b/i;

export const PAGES_DIRECTORY_PATTERN = /\/pages\//;

export const NEXTJS_NAVIGATION_FUNCTIONS = new Set([
  "redirect",
  "permanentRedirect",
  "notFound",
  "forbidden",
  "unauthorized",
]);

export const GOOGLE_FONTS_PATTERN = /fonts\.googleapis\.com/;

export const POLYFILL_SCRIPT_PATTERN = /polyfill\.io|polyfill\.min\.js|cdn\.polyfill/;

export const EXECUTABLE_SCRIPT_TYPES = new Set([
  "text/javascript",
  "application/javascript",
  "module",
]);

export const APP_DIRECTORY_PATTERN = /\/app\//;

export const ROUTE_HANDLER_FILE_PATTERN = /\/route\.(tsx?|jsx?)$/;

export const MUTATION_METHOD_NAMES = new Set([
  "create",
  "insert",
  "insertInto",
  "update",
  "upsert",
  "delete",
  "remove",
  "destroy",
  "set",
  "append",
]);

// In-place Array.prototype mutators. These are the canonical "mutating"
// methods used to flag direct mutation of useState values (e.g. an
// `items` from `useState([])` that gets `.push()`ed). The immutable
// counterparts (toSorted/toReversed/toSpliced/with) are intentionally
// excluded; those return a new array.
export const MUTATING_ARRAY_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

export const MUTATING_HTTP_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export const MUTATING_ROUTE_SEGMENTS = new Set([
  "logout",
  "log-out",
  "signout",
  "sign-out",
  "unsubscribe",
  "delete",
  "remove",
  "revoke",
  "cancel",
  "deactivate",
]);

export const EFFECT_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect"]);
export const HOOKS_WITH_DEPS = new Set(["useEffect", "useLayoutEffect", "useMemo", "useCallback"]);

// Direct CallExpression callees that schedule a callback to run later,
// outside the current render's microtask. Two distinct rules consume this
// set, so the names below intentionally describe the shape (timers and
// schedulers) rather than either rule's interpretation.
//
// Consumers:
//   - `prefer-use-effect-event` treats them as "sub-handler" boundaries:
//     calling a reactive value from inside the scheduled callback is the
//     classic case for `useEffectEvent` (see "Separating Events from
//     Effects").
//   - `no-effect-chain` treats them as external-sync direct callees so a
//     useEffect that only schedules timers is exempt from the chain rule.
export const TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES = new Set([
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
]);

// Timer registrations that ALWAYS need a corresponding cleanup call
// (a stricter subset of the scheduler list above — `requestAnimationFrame`
// and friends already invoke once and self-clean, but `setTimeout` /
// `setInterval` keep firing until explicitly cleared).
export const TIMER_CALLEE_NAMES_REQUIRING_CLEANUP = new Set(["setInterval", "setTimeout"]);

export const TIMER_CLEANUP_CALLEE_NAMES = new Set(["clearInterval", "clearTimeout"]);

// Globals whose values mutate outside the React data flow. Listing
// them as deps doesn't trigger a re-run when they change because
// React compares deps with `Object.is` during render — and the read
// happens during render, before the mutation. From "Lifecycle of
// Reactive Effects" — Can global or mutable values be dependencies?
export const MUTABLE_GLOBAL_ROOTS = new Set([
  "location",
  "window",
  "document",
  "navigator",
  "history",
  "screen",
  "performance",
]);

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

export const EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS = new Set([
  "IntersectionObserver",
  "MutationObserver",
  "ResizeObserver",
  "PerformanceObserver",
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
export const CHAINABLE_ITERATION_METHODS = new Set(["map", "filter", "forEach", "flatMap"]);
export const STORAGE_OBJECTS = new Set(["localStorage", "sessionStorage"]);

export const LARGE_BLUR_THRESHOLD_PX = 10;
export const BLUR_VALUE_PATTERN = /blur\((\d+(?:\.\d+)?)px\)/;
export const ANIMATION_CALLBACK_NAMES = new Set(["requestAnimationFrame", "setInterval"]);
export const MOTION_LIBRARY_PACKAGES = new Set(["framer-motion", "motion"]);

export const RAW_TEXT_PREVIEW_MAX_CHARS = 30;

export const REACT_NATIVE_TEXT_COMPONENTS = new Set([
  "Text",
  "TextInput",
  "Typography",
  "Paragraph",
  "Span",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

export const REACT_NATIVE_TEXT_COMPONENT_KEYWORDS = new Set([
  "Text",
  "Title",
  "Label",
  "Heading",
  "Caption",
  "Subtitle",
  "Typography",
  "Paragraph",
  "Description",
  "Body",
]);

export const DEPRECATED_RN_MODULE_REPLACEMENTS: Record<string, string> = {
  AsyncStorage: "@react-native-async-storage/async-storage",
  Picker: "@react-native-picker/picker",
  PickerIOS: "@react-native-picker/picker",
  DatePickerIOS: "@react-native-community/datetimepicker",
  DatePickerAndroid: "@react-native-community/datetimepicker",
  ProgressBarAndroid: "a community alternative",
  ProgressViewIOS: "a community alternative",
  SafeAreaView: "react-native-safe-area-context",
  Slider: "@react-native-community/slider",
  ViewPagerAndroid: "react-native-pager-view",
  WebView: "react-native-webview",
  NetInfo: "@react-native-community/netinfo",
  CameraRoll: "@react-native-camera-roll/camera-roll",
  Clipboard: "@react-native-clipboard/clipboard",
  ImageEditor: "@react-native-community/image-editor",
  MaskedViewIOS: "@react-native-masked-view/masked-view",
};

export const LEGACY_EXPO_PACKAGE_REPLACEMENTS: Record<string, string> = {
  "expo-av": "expo-audio for audio and expo-video for video",
  "expo-permissions": "the permissions API in each module (e.g. Camera.requestPermissionsAsync())",
  "@expo/vector-icons":
    "expo-symbols or expo-image (see https://docs.expo.dev/versions/latest/sdk/symbols/)",
};

export const REACT_NATIVE_LIST_COMPONENTS = new Set([
  "FlatList",
  "SectionList",
  "VirtualizedList",
  "FlashList",
]);

export const LEGACY_SHADOW_STYLE_PROPERTIES = new Set([
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
]);

export const BOUNCE_ANIMATION_NAMES = new Set(["bounce", "elastic", "wobble", "jiggle", "spring"]);

export const Z_INDEX_ABSURD_THRESHOLD = 100;

export const INLINE_STYLE_PROPERTY_THRESHOLD = 8;

export const SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX = 3;

export const SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX = 1;

export const SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS = 4;

export const DARK_GLOW_BLUR_THRESHOLD_PX = 4;

export const DARK_BACKGROUND_CHANNEL_MAX = 35;

export const COLOR_CHROMA_THRESHOLD = 30;

export const TINY_TEXT_THRESHOLD_PX = 12;

export const WIDE_TRACKING_THRESHOLD_EM = 0.05;

export const LONG_TRANSITION_DURATION_THRESHOLD_MS = 1000;

export const HEAVY_HEADING_FONT_WEIGHT_MIN = 700;

export const HEADING_TAG_NAMES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export const HEAVY_HEADING_TAILWIND_WEIGHTS = new Set([
  "font-bold",
  "font-extrabold",
  "font-black",
]);

export const TAILWIND_DEFAULT_PALETTE_NAMES = ["indigo", "gray", "slate"];

export const TAILWIND_PALETTE_UTILITY_PREFIXES = [
  "text",
  "bg",
  "border",
  "ring",
  "fill",
  "stroke",
  "from",
  "to",
  "via",
  "decoration",
  "divide",
  "outline",
  "placeholder",
  "caret",
  "accent",
  "shadow",
];

export const VAGUE_BUTTON_LABELS = new Set([
  "continue",
  "submit",
  "ok",
  "okay",
  "click here",
  "here",
  "yes",
  "no",
  "go",
  "done",
]);

export const ELLIPSIS_EXCLUDED_TAG_NAMES = new Set(["code", "pre", "kbd", "samp", "var", "tt"]);

export const EM_DASH_CHARACTER = "\u2014";

// HACK: trailing boundary uses a LOOKAHEAD `(?=...)` so the whitespace
// between Tailwind tokens isn't consumed. With a consuming `(?:$|\s|:)`
// trailing group, `matchAll` over `"px-4 px-6"` would catch `px-4` plus
// the trailing space, then fail to find a leading `\s` boundary for
// `px-6` because we just ate it — silently skipping the second token.
export const PADDING_HORIZONTAL_AXIS_PATTERN =
  /(?:^|\s)(-?)px-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/g;

export const PADDING_VERTICAL_AXIS_PATTERN =
  /(?:^|\s)(-?)py-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/g;

export const SIZE_WIDTH_AXIS_PATTERN = /(?:^|\s)(-?)w-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/g;

export const SIZE_HEIGHT_AXIS_PATTERN = /(?:^|\s)(-?)h-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/g;

export const FLEX_OR_GRID_DISPLAY_TOKENS = new Set(["flex", "inline-flex", "grid", "inline-grid"]);

export const SPACE_AXIS_PATTERN = /(?:^|\s)(?:-)?space-(x|y)-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/;

export const TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN = /[A-Za-z]\.\.\./;
