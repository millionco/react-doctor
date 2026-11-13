export const MODERN_REACT_MAJOR = 19;
export const MODERN_REACT_EXPORTS: ReadonlySet<string> = new Set([
  "Fragment",
  "StrictMode",
  "Suspense",
  "Profiler",
  "Component",
  "PureComponent",
  "cloneElement",
  "createElement",
  "createContext",
  "createRef",
  "forwardRef",
  "isValidElement",
  "lazy",
  "memo",
  "startTransition",
  "act",
  "cache",
  "captureOwnerStack",
  "use",
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
  "version",
]);
export const MODERN_REACT_DOM_EXPORTS: ReadonlySet<string> = new Set([
  "createPortal",
  "flushSync",
  "unstable_batchedUpdates",
  "useFormState",
  "useFormStatus",
  "preconnect",
  "prefetchDNS",
  "preinit",
  "preinitModule",
  "preload",
  "preloadModule",
  "requestFormReset",
  "version",
]);
export const MODERN_REACT_DOM_CLIENT_EXPORTS: ReadonlySet<string> = new Set([
  "createRoot",
  "hydrateRoot",
  "version",
]);
export const MODERN_NEXT_MAJOR = 16;
export const MODERN_NEXT_OUTPUT_MODES: ReadonlySet<string> = new Set(["export", "standalone"]);
export const MODERN_NEXT_CONST_EXPORT_STATEMENT_COUNT = 2;
export const NATIVE_UI_SDK_MAJOR = 1;
export const PNPM_ROLE_MAX_BYTES = 262_144;
export const PNPM_ROLE_MAX_LINES = 5_000;
export const PNPM_ROLE_MAX_DEPTH = 12;
export const PNPM_ROLE_INDENT_SPACES = 2;
export const PNPM_ROLE_MIN_PRINTABLE_CODE_POINT = 32;
export const PNPM_ROLE_PROTECTED_PACKAGES: ReadonlySet<string> = new Set([
  "@base-ui/react",
  "lucide-react",
  "react",
  "react-dom",
  "next",
  "marked",
]);
export const MARKED_RENDERER_MAJOR = 18;
export const MARKED_RENDERER_VERSION = "18.0.14";
export const MARKED_RENDERER_INTEGRITY =
  "sha512-mBHK6FBHuBAlhgRe88w9F0O1AbwwXJUcQibUbC/QcdTbVGAD7aWza+xt3N6oT/jCZx3/OMeS+8rnuiHZcQ9s7A==";
export const PNPM_LOCK_ROLE_MAX_FILE_BYTES = 1_048_576;
export const PNPM_LOCK_ROLE_MAX_AGGREGATE_BYTES = 2_097_152;
export const PNPM_LOCK_ROLE_MAX_DEPTH = 64;
export const PNPM_LOCK_ROLE_MAX_NODES = 250_000;
export const PNPM_LOCK_ROLE_VERSION = "9.0";
export const PNPM_LOCK_ROLE_DEPENDENCY_FIELDS: ReadonlyArray<string> = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];
export const MARKED_RENDERER_DECLARED_RANGES: ReadonlySet<string> = new Set([
  "18.0.14",
  "^18.0.14",
  "~18.0.14",
]);
export const MARKED_RENDERER_ESM_PATH = "./lib/marked.esm.js";
export const MARKED_RENDERER_BROWSER_PATH = "./lib/marked.umd.js";
export const MARKED_RENDERER_TYPES_PATH = "./lib/marked.d.ts";
export const MARKED_RENDERER_EXPORT_PATHS: ReadonlyMap<string, string> = new Map([
  ["./bin/marked", "./bin/marked.js"],
  ["./package.json", "./package.json"],
]);
export const MARKED_RENDERER_METHOD_NAMES: ReadonlySet<string> = new Set([
  "space",
  "code",
  "blockquote",
  "html",
  "def",
  "heading",
  "hr",
  "list",
  "listitem",
  "checkbox",
  "paragraph",
  "table",
  "tablerow",
  "tablecell",
  "strong",
  "em",
  "codespan",
  "br",
  "del",
  "link",
  "image",
  "text",
]);
export const RUNTIME_ROLE_DEPENDENCY_FIELDS: ReadonlyArray<string> = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
export const NATIVE_UI_SDK_PACKAGE_BY_SOURCE: ReadonlyMap<string, string> = new Map([
  ["@base-ui/react/avatar", "@base-ui/react"],
  ["@base-ui/react/use-render", "@base-ui/react"],
  ["@base-ui/react/merge-props", "@base-ui/react"],
  ["lucide-react", "lucide-react"],
]);
export const NATIVE_UI_SDK_MAPPING_FIELDS: ReadonlyArray<string> = [
  "overrides",
  "resolutions",
  "browser",
  "imports",
  "pnpm",
  "packageExtensions",
];
export const NATIVE_UI_SDK_MAPPING_CONFIG_NAMES: ReadonlyArray<string> = [
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
  ".pnp.cjs",
  ".pnp.js",
  ".pnp.loader.mjs",
  "import-map.json",
  "importmap.json",
];
export const PACKAGE_VERSION_SEGMENT_COUNT = 3;
export const MODERN_ROLE_BABEL_CONFIG_NAMES: ReadonlyArray<string> = [
  ".babelrc",
  ".babelrc.js",
  ".babelrc.json",
  ".babelrc.cjs",
  ".babelrc.mjs",
  ".babelrc.cts",
  "babel.config.js",
  "babel.config.json",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
  "babel.config.cts",
];
export const MODERN_NEXT_CONFIG_NAMES: ReadonlyArray<string> = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
  "next.config.mts",
  "next.config.cts",
];
export const MODERN_ROLE_PACKAGES: ReadonlyArray<string> = ["react", "react-dom", "next"];
export const MODERN_ROLE_FORBIDDEN_IMPORTS: ReadonlySet<string> = new Set([
  "module",
  "node:module",
  "react-dom/unstable_testing",
  "react-reconciler",
  "react-test-renderer",
  "react-native",
  "preact",
  "@wordpress/element",
]);
export const MODERN_ROLE_REACT_ONLY_HOOKS: ReadonlySet<string> = new Set([
  "useState",
  "useReducer",
  "useRef",
  "useEffect",
  "useLayoutEffect",
  "useImperativeHandle",
]);
export const MODERN_ROLE_ROOT_METHODS: ReadonlySet<string> = new Set(["createRoot", "hydrateRoot"]);
export const MODERN_ROLE_LEGACY_METHODS: ReadonlySet<string> = new Set([
  "render",
  "hydrate",
  "unstable_renderSubtreeIntoContainer",
  "unmountComponentAtNode",
]);

export const TYPE_ONLY_DEFAULT_EXPORT_NEXT_VERSION = "16.3.6";
