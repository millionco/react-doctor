export const GIANT_COMPONENT_LINE_THRESHOLD = 300;
export const CASCADING_SET_STATE_THRESHOLD = 3;
export const RELATED_USE_STATE_THRESHOLD = 5;
export const DEEP_NESTING_THRESHOLD = 3;
export const DUPLICATE_STORAGE_READ_THRESHOLD = 2;
export const SEQUENTIAL_AWAIT_THRESHOLD = 3;
export const SECRET_MIN_LENGTH_CHARS = 8;
export const AUTH_CHECK_LOOKAHEAD_STATEMENTS = 3;

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

export const FETCH_CALLEE_NAMES = new Set(["fetch"]);
export const FETCH_MEMBER_OBJECTS = new Set(["axios", "ky", "got"]);
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
export const SERVER_ACTION_FILE_PATTERN = /actions?\.(tsx?|jsx?)$/;
export const SERVER_ACTION_DIRECTORY_PATTERN = /\/actions\//;

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
