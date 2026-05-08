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

// Used by `no-event-trigger-state` to recognize when a useEffect body
// is performing the §6 anti-pattern from "You Might Not Need an Effect"
// — running an event-shaped side effect (POST, navigation, notification,
// analytics) that the user actually triggered with a button click.
// Tightly scoped on purpose — adding a callee name here can produce
// false positives on pure helper functions, so the bar is "this name
// almost always denotes a fire-and-forget user-action effect."
export const EVENT_TRIGGERED_SIDE_EFFECT_CALLEES = new Set([
  // Network shorthand verbs (article uses `post`)
  "fetch",
  "post",
  "put",
  "patch",
  "del",
  // Common HTTP client wrappers
  "ky",
  "got",
  "wretch",
  "ofetch",
  // Navigation
  "navigate",
  "navigateTo",
  // UI side effects
  "showNotification",
  "toast",
  "alert",
  "confirm",
  // Analytics
  "track",
  "logEvent",
  "logVisit",
  "captureEvent",
]);

// Recognized when the call shape is `<obj>.<method>(...)` — covers
// `axios.post`, `api.post`, `router.push`, `analytics.track`,
// `posthog.capture`, etc. without enumerating every possible object.
export const EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS = new Set([
  "post",
  "put",
  "patch",
  "delete",
  "push",
  "replace",
  "navigate",
  "capture",
  "track",
  "logEvent",
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
