import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";

export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const REF_NOTIFICATION_INACTIVE_ATTRIBUTES: ReadonlySet<string> = new Set([
  "disabled",
  "inert",
  "hidden",
  "aria-disabled",
  "is",
  "dangerouslySetInnerHTML",
  "children",
]);
export const REF_NOTIFICATION_INACTIVE_CONTENT_TAGS: ReadonlySet<string> = new Set([
  "template",
  "iframe",
  "noscript",
  "textarea",
]);
export const REF_NOTIFICATION_EVENT_ANCESTOR_TAGS: ReadonlySet<string> = new Set([
  "title",
  "style",
  "script",
]);
export const REF_NOTIFICATION_RUNTIME_CAPABILITIES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "globalThis",
  "window",
  "self",
  "require",
  "module",
  "exports",
]);
export const REF_NOTIFICATION_RUNTIME_TYPESCRIPT: ReadonlySet<string> = new Set([
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSModuleDeclaration",
]);

export const REF_NOTIFICATION_PASSIVE_OBJECT_METHODS: ReadonlySet<string> = new Set([
  "keys",
  "freeze",
]);
export const REF_NOTIFICATION_WORK_COMPONENT_COUNT = 32;
export const REF_NOTIFICATION_SCOPE_LOOKUPS_PER_COMPONENT_COUNT = 128;

export const REF_NOTIFICATION_UNSUPPORTED_RENDER_CONTROL_TYPES: ReadonlySet<string> = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "TryStatement",
  "WithStatement",
]);

export const OWNED_ABORT_UNSUPPORTED_CAPABILITY_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "Proxy",
  "AbortSignal",
  "globalThis",
  "window",
  "self",
  "global",
  "process",
  "require",
  "module",
  "exports",
]);
export const OWNED_ABORT_UNSUPPORTED_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "AbortController",
  "AbortSignal",
]);
export const OWNED_ABORT_UNSUPPORTED_RUNTIME_TYPES: ReadonlySet<string> = new Set([
  "WithStatement",
  "ImportExpression",
  "MetaProperty",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSModuleBlock",
]);
export const OWNED_ABORT_UNSUPPORTED_CONTINUATION_TYPES: ReadonlySet<string> = new Set([
  "IfStatement",
  "ConditionalExpression",
  "LogicalExpression",
  "SwitchStatement",
  "TryStatement",
  "CatchClause",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "ReturnStatement",
  "ThrowStatement",
  "BreakStatement",
  "ContinueStatement",
  "YieldExpression",
]);

export const RADIX_DRAFT_MODULE_SOURCE = "@radix-ui/react-dropdown-menu";
export const RADIX_DRAFT_MAX_BRIDGE_COUNT = 4;
export const RADIX_DRAFT_EMPTY_COUNT = 0;
export const RADIX_DRAFT_SINGLE_COUNT = 1;
export const RADIX_DRAFT_PAIR_COUNT = 2;
export const RADIX_DRAFT_THREE_STATEMENTS_COUNT = 3;
export const RADIX_DRAFT_FIRST_INDEX = 0;
export const RADIX_DRAFT_SECOND_INDEX = 1;
export const RADIX_DRAFT_LAST_INDEX = -1;
export const RADIX_DRAFT_FORBIDDEN_ATTRIBUTES: ReadonlySet<string> = new Set([
  "disabled",
  "hidden",
  "inert",
  "asChild",
  "contentEditable",
  "dangerouslySetInnerHTML",
  "onSelect",
  "onClick",
  "onPointerDown",
  "onMouseDown",
  "onKeyDown",
  "children",
  "ref",
  "is",
]);
export const RADIX_DRAFT_FORBIDDEN_CAPABILITIES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "globalThis",
  "window",
  "self",
  "global",
  "process",
  "require",
  "module",
  "exports",
  "React",
  "arguments",
]);
export const RADIX_DRAFT_FORBIDDEN_MEMBERS: ReadonlySet<string> = new Set([
  "prototype",
  "__proto__",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "defaultProps",
  "innerHTML",
  "outerHTML",
  "textContent",
  "setAttribute",
  "removeChild",
  "appendChild",
  "replaceChild",
  "insertAdjacentHTML",
  "remove",
  "replaceChildren",
  "replaceWith",
  "createElement",
  "cloneElement",
]);
export const RADIX_DRAFT_RUNTIME_TYPESCRIPT: ReadonlySet<string> = new Set([
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);

export const ASYNC_WHILE_UNSUPPORTED_CONTROL_TYPES: ReadonlySet<string> = new Set([
  "BreakStatement",
  "ContinueStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "LabeledStatement",
  "SwitchStatement",
  "ThrowStatement",
  "TryStatement",
]);

export const FINITE_COUNTDOWN_BODY_STATEMENT_COUNT = 3;
export const FINITE_COUNTDOWN_DECREMENT_COUNT = 1;
export const FINITE_COUNTDOWN_MINIMUM_REPEAT_COUNT = 2;
export const FINITE_COUNTDOWN_MINIMUM_ITERATION_COUNT = 0;
export const FINITE_COUNTDOWN_MAXIMUM_ITERATION_COUNT = 8;
export const FINITE_COUNTDOWN_TERMINAL_COUNT = 0;
export const CONTEXT_RECORD_EVENT_CALLER_STRESS_LAYER_COUNT = 24;

export const GENERATION_MASK_INITIAL_VALUE = 0;
export const GENERATION_MASK_INCREMENT_VALUE = 1;
export const GENERATION_MASK_INACTIVE_TAG_VALUE = -1;

export const ASYNC_FINALLY_STRESS_LAYER_COUNT = 32;

export const OWNED_INPUT_HOST_NAMES: ReadonlySet<string> = new Set([
  "input",
  "div",
  "label",
  "ul",
  "button",
]);
export const OWNED_INPUT_RESERVED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "as",
  "$as",
  "forwardedAs",
  "asChild",
  "is",
  "ref",
  "innerRef",
  "children",
  "dangerouslySetInnerHTML",
]);
export const OWNED_INPUT_PROVIDER_SOURCES = [
  "react",
  "react-dom",
  "styled-components",
  "@babel/preset-react",
  "@babel/preset-env",
  "babel-plugin-styled-components",
];
export const OWNED_INPUT_REFUSED_MANIFEST_FIELDS = [
  "overrides",
  "resolutions",
  "pnpm",
  "browser",
  "imports",
  "exports",
  "alias",
  "react-native",
];
export const OWNED_INPUT_REFUSED_GLOBALS: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "globalThis",
  "global",
  "self",
  "require",
  "module",
  "exports",
  "HTMLElement",
  "HTMLInputElement",
  "Element",
  "Node",
  "Document",
  "Window",
]);
export const OWNED_INPUT_RUNTIME_TYPES: ReadonlySet<string> = new Set([
  "WithStatement",
  "ImportExpression",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSModuleDeclaration",
  "ExportNamespaceSpecifier",
]);
export const OWNED_INPUT_PROTECTED_NATIVE_MEMBERS: ReadonlySet<string> = new Set([
  "focus",
  "contains",
  "activeElement",
  "createElement",
]);
export const OWNED_INPUT_METADATA_NAMES: ReadonlySet<string> = new Set([
  "displayName",
  "propTypes",
]);
export const OWNED_INPUT_EMPTY_COUNT = 0;
export const OWNED_INPUT_SINGLE_COUNT = 1;
export const OWNED_INPUT_FIRST_INDEX = 0;
export const OWNED_INPUT_MAX_RESOLUTION_DEPTH = 24;
export const OWNED_INPUT_DECLARED_REACT_PATTERN = /^[~^]?(?:16|17|18)(?:\.\d+){0,2}$/u;
export const OWNED_INPUT_DECLARED_STYLED_PATTERN = /^[~^]?5\.\d+\.\d+$/u;

export const OWNED_INPUT_PASSIVE_PROTOTYPE_NAMES: ReadonlySet<string> = new Set([
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
]);
export const OWNED_INPUT_OBJECT_METHOD_NAMES: ReadonlySet<string> = new Set([
  "keys",
  "values",
  "entries",
  "freeze",
  "assign",
  "defineProperty",
]);
export const OWNED_INPUT_WINDOW_READ_NAMES: ReadonlySet<string> = new Set([
  "addEventListener",
  "removeEventListener",
  "matchMedia",
]);
export const OWNED_INPUT_DOCUMENT_READ_NAMES: ReadonlySet<string> = new Set([
  "activeElement",
  "body",
  "createElement",
  "querySelector",
  "addEventListener",
  "removeEventListener",
]);

export const OWNED_INPUT_BUILD_RECIPE_PATTERN =
  /^(?:cross-env NODE_ENV=production )?babel \.?\/?[\w./-]+ --out-dir [\w./-]+ --copy-files$/u;
export const OWNED_INPUT_CUSTOM_COMPILER_PATTERN =
  /(?:--(?:plugins?|presets?|config(?:-file)?|loader|require)(?:[=\s]|$)|(?:^|[\s;&|])(?:webpack|rollup|vite|tsx|ts-node)(?:[\s;&|]|$)|(?:^|[\s;&|])node\s+(?:-e|--eval|-r|--require)(?:[=\s]|$))/u;

export const OWNED_INPUT_REACT_API_NAMES: ReadonlySet<string> = new Set([
  "createElement",
  "useRef",
  "useCallback",
  "useState",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

export const OWNED_INPUT_PAIR_COUNT = 2;

export const OWNED_INPUT_NATIVE_RESULT_METHOD_NAMES: ReadonlySet<string> = new Set([
  "querySelector",
  "querySelectorAll",
  "createElement",
  "getElementById",
  "getElementsByClassName",
  "getElementsByTagName",
]);

export const OWNED_INPUT_NATIVE_CALL_NAMES: ReadonlySet<string> = new Set([
  "querySelector",
  "querySelectorAll",
  "createElement",
  "getElementById",
  "getElementsByClassName",
  "getElementsByTagName",
  "focus",
  "contains",
  "appendChild",
  "removeChild",
  "addEventListener",
  "removeEventListener",
  "matchMedia",
]);
export const OWNED_INPUT_NATIVE_CONTAINER_METHOD_NAMES: ReadonlySet<string> = new Set([
  "contains",
  "appendChild",
  "removeChild",
]);

export const OWNED_INPUT_DATA_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "parseInt",
  "undefined",
  "NaN",
  "Infinity",
]);

export const OWNED_INPUT_TIMER_NAMES: ReadonlySet<string> = new Set(["setTimeout", "setInterval"]);
export const OWNED_INPUT_INPUT_SCALAR_NAMES: ReadonlySet<string> = new Set([
  "value",
  "checked",
  "selectedIndex",
  "selectionStart",
  "selectionEnd",
  "disabled",
  "id",
  "className",
  "type",
  "tagName",
  "nodeName",
  "nodeType",
]);
export const OWNED_INPUT_EVENT_SCALAR_NAMES: ReadonlySet<string> = new Set([
  "key",
  "code",
  "type",
  "keyCode",
  "which",
  "charCode",
  "altKey",
  "ctrlKey",
  "metaKey",
  "shiftKey",
  "defaultPrevented",
  "bubbles",
  "cancelable",
  "timeStamp",
  "isTrusted",
  "button",
  "buttons",
  "clientX",
  "clientY",
]);

export const OWNED_INPUT_EVENT_METHOD_NAMES: ReadonlySet<string> = new Set([
  "preventDefault",
  "stopPropagation",
  "persist",
  "isDefaultPrevented",
  "isPropagationStopped",
]);

export const OWNED_INPUT_ADD_LISTENER_NAMES: ReadonlySet<string> = new Set(["addEventListener"]);
export const OWNED_INPUT_LISTENER_NAMES: ReadonlySet<string> = new Set([
  "addEventListener",
  "removeEventListener",
]);
export const OWNED_INPUT_NATIVE_EVENT_METHOD_NAMES: ReadonlySet<string> = new Set([
  "preventDefault",
  "stopPropagation",
]);
export const OWNED_INPUT_CALLABLE_TRANSPORT_NAMES: ReadonlySet<string> = new Set([
  "call",
  "apply",
  "bind",
  "constructor",
  "prototype",
]);
export const OWNED_INPUT_CALLABLE_ARGUMENT_NAMES: ReadonlySet<string> = new Set([
  "then",
  "catch",
  "finally",
  "map",
  "flatMap",
  "forEach",
  "filter",
  "find",
  "findIndex",
  "some",
  "every",
  "reduce",
  "reduceRight",
  "sort",
  "addEventListener",
  "removeEventListener",
]);

export const OWNED_INPUT_NATIVE_ARRAY_METHOD_NAMES: ReadonlySet<string> = new Set([
  "at",
  "concat",
  "copyWithin",
  "entries",
  "every",
  "fill",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "pop",
  "push",
  "reduce",
  "reduceRight",
  "reverse",
  "shift",
  "slice",
  "some",
  "sort",
  "splice",
  "toLocaleString",
  "toReversed",
  "toSorted",
  "toSpliced",
  "toString",
  "unshift",
  "values",
  "with",
]);
export const OWNED_INPUT_NATIVE_STRING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "at",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "concat",
  "endsWith",
  "includes",
  "indexOf",
  "lastIndexOf",
  "localeCompare",
  "match",
  "matchAll",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "search",
  "slice",
  "split",
  "startsWith",
  "substring",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "toLowerCase",
  "toString",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
  "valueOf",
]);
export const OWNED_INPUT_CALLABLE_STYLED_NAMES: ReadonlySet<string> = new Set([
  "default",
  "styled",
  "css",
  "keyframes",
  "createGlobalStyle",
]);

export const OWNED_INPUT_CALLABLE_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "unescape",
  "Number",
  "BigInt",
  "Boolean",
  "String",
  "Array",
  "Object",
  "RegExp",
  "Date",
  "Promise",
  "Symbol",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "FinalizationRegistry",
  "Error",
  "AggregateError",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

export const OWNED_NATIVE_REF_RESERVED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "as",
  "$as",
  "forwardedAs",
  "asChild",
  "is",
  "innerRef",
  "children",
  "dangerouslySetInnerHTML",
]);

export const OWNED_NATIVE_REF_SINGLE_VALUE_COUNT = 1;
export const OWNED_NATIVE_REF_MINIMUM_CHILD_INDEX = 0;

export const OWNED_NATIVE_REF_CALLBACK_RECEIVER_TYPES: ReadonlySet<string> = new Set([
  "ThisExpression",
  "Super",
  "MetaProperty",
]);

export const OWNED_DOM_EMPTY_COUNT = 0;
export const OWNED_DOM_SINGLE_COUNT = 1;
export const OWNED_DOM_NEGATIVE_ONE = -1;
export const OWNED_DOM_REACT_CLASS_NAMES: ReadonlySet<string> = new Set([
  "Component",
  "PureComponent",
]);
export const OWNED_DOM_CLASS_METADATA_NAMES: ReadonlySet<string> = new Set([
  "displayName",
  "propTypes",
  "defaultProps",
]);
export const OWNED_DOM_RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "props",
  "state",
  "refs",
  "context",
  "updater",
  "setState",
  "forceUpdate",
]);
export const OWNED_DOM_KEY_EVENT_NAMES: ReadonlySet<string> = new Set([
  "keydown",
  "keyup",
  "keypress",
]);
export const OWNED_DOM_KEY_SCALAR_NAMES: ReadonlySet<string> = new Set([
  "key",
  "keyCode",
  "shiftKey",
]);
export const OWNED_DOM_LISTENER_NAMES: ReadonlySet<string> = new Set([
  "addEventListener",
  "removeEventListener",
]);

export const OWNED_DOM_PAIR_COUNT = 2;

export const OWNED_CSS_RECORD_EMPTY_COUNT = 0;
export const OWNED_CSS_RECORD_SINGLE_COUNT = 1;
export const OWNED_CSS_RECORD_PAIR_COUNT = 2;
export const OWNED_CSS_RECORD_FIRST_INDEX = 0;
export const OWNED_CSS_RECORD_SECOND_INDEX = 1;
export const OWNED_CSS_RECORD_MAX_RESOLUTION_DEPTH = 24;
export const OWNED_CSS_RECORD_ZERO_VALUE = 0;

export const OWNED_INPUT_RESTORATION_DEPENDENCY_HOOK_NAMES: ReadonlySet<string> = new Set([
  ...EFFECT_HOOK_NAMES,
  "useCallback",
]);

export const IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES: ReadonlySet<string> = new Set([
  "as",
  "asChild",
  "is",
  "forwardedAs",
  "$as",
  "innerRef",
]);
export const IMPORTED_NATIVE_CONTROL_REACT_API_NAMES: ReadonlySet<string> = new Set([
  "forwardRef",
  "createElement",
  "useState",
  "useReducer",
  "useCallback",
]);

export const IMPORTED_NATIVE_CONTROL_SINGLE_COUNT = 1;
export const IMPORTED_NATIVE_CONTROL_RENDER_PARAMETER_COUNT = 2;

export const REFERENCED_TSCONFIG_SINGLE_COUNT = 1;

export const CANONICAL_CONTROL_PAIR_COUNT = 2;
export const CANONICAL_CONTROL_CRACO_STATEMENT_COUNT = 3;
export const CANONICAL_CONTROL_STYLED_MAJOR = 5;
export const CANONICAL_CONTROL_REFUSED_MANIFEST_FIELDS = [
  "browser",
  "exports",
  "imports",
  "alias",
  "resolutions",
  "overrides",
  "pnpm",
  "_moduleAliases",
  "babel",
  "react-native",
];
export const CANONICAL_CONTROL_PROVIDER_SOURCES = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "styled-components",
  "firebase",
  "firebase/auth",
  "@firebase/auth",
];
export const CANONICAL_CONTROL_REFUSED_CONFIG_FILENAMES = [
  "webpack.config.js",
  "webpack.config.cjs",
  "webpack.config.mjs",
  "webpack.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts",
  "craco.config.cjs",
  "craco.config.ts",
];
export const FIREBASE_PASSWORD_SIGN_IN_VERSION = "9.0.1";
export const FIREBASE_PASSWORD_SIGN_IN_DECLARATION_PATTERN = /^[~^]?9\.0\.1$/u;
export const FIREBASE_PASSWORD_SIGN_IN_ARCHIVE_URL =
  "https://registry.npmjs.org/firebase/-/firebase-9.0.1.tgz";
export const FIREBASE_PASSWORD_SIGN_IN_ARCHIVE_INTEGRITY =
  "sha512-RMpbXsVlxqMX+s/gYudnUZeSZXPiLCJMdaxbZ0WRiMjLuJc6ZkbpRy7yz7rZQpL0wRD6gN4K5C+JaKEQtN3jAQ==";
export const FIREBASE_PASSWORD_SIGN_IN_ARGUMENT_COUNT = 3;
export const FIREBASE_AUTH_ALLOWED_API_NAMES: ReadonlySet<string> = new Set([
  "getAuth",
  "signInWithEmailAndPassword",
  "signInWithPopup",
  "GoogleAuthProvider",
  "onAuthStateChanged",
]);
export const FIREBASE_AUTH_INSTANCE_API_NAMES: ReadonlySet<string> = new Set([
  "signInWithEmailAndPassword",
  "signInWithPopup",
  "onAuthStateChanged",
]);
export const FIREBASE_AUTH_REFUSED_SOURCE_NAMES: ReadonlySet<string> = new Set([
  "firebase",
  "@firebase/auth",
  "firebase/compat",
  "firebase/compat/auth",
  "module",
  "node:module",
  "vm",
  "node:vm",
]);
export const CANONICAL_CONTROL_LOCK_VERSIONS: ReadonlySet<number> = new Set([2, 3]);
export const CANONICAL_CONTROL_SCRIPT_RECIPES: ReadonlySet<string> = new Set([
  "craco start",
  "craco build",
  "craco test",
  "react-scripts start",
  "react-scripts build",
  "react-scripts test",
  "react-scripts eject",
]);
export const CANONICAL_CONTROL_REFUSED_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "require",
  "eval",
  "Function",
  "globalThis",
  "window",
  "global",
]);

export const OWN_HOOK_SINGLE_COUNT = 1;
export const OWN_HOOK_FIRST_INDEX = 0;
export const OWN_HOOK_EVENT_NAMES: ReadonlySet<string> = new Set(["onSubmit", "onClick"]);
export const OWN_HOOK_GUARD_ATTRIBUTES: ReadonlySet<string> = new Set([
  "disabled",
  "loading",
  "isLoading",
  "pending",
  "busy",
  "submitting",
  "aria-disabled",
  "onSubmitCapture",
  "onClickCapture",
  "onKeyDownCapture",
]);
export const OWN_HOOK_DATA_OBJECT_METHODS: ReadonlySet<string> = new Set([
  "keys",
  "values",
  "entries",
]);
export const OWN_HOOK_PROVIDER_CAPABILITIES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "defaultProps",
  "attrs",
  "withConfig",
]);
export const OWN_HOOK_REACT_API_NAMES: ReadonlySet<string> = new Set([
  "useState",
  "useReducer",
  "useRef",
]);
export const OWN_HOOK_RUNTIME_TS_NODES: ReadonlySet<string> = new Set([
  "TSParameterProperty",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);
export const OWN_HOOK_STATE_API_NAMES: ReadonlySet<string> = new Set(["useState", "useReducer"]);
export const OWN_HOOK_UNSUPPORTED_PREAWAIT_NODES: ReadonlySet<string> = new Set([
  "AssignmentExpression",
  "UpdateExpression",
  "NewExpression",
  "TaggedTemplateExpression",
  "YieldExpression",
  "LogicalExpression",
  "ConditionalExpression",
  "SwitchStatement",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
]);

export const STREAM_CHANNEL_PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  "stream-chat": "4.1.0",
  "stream-chat-react": "6.5.1",
};
export const STREAM_CHANNEL_ARCHIVE_URLS: Readonly<Record<string, string>> = {
  "stream-chat": "https://registry.npmjs.org/stream-chat/-/stream-chat-4.1.0.tgz",
  "stream-chat-react": "https://registry.npmjs.org/stream-chat-react/-/stream-chat-react-6.5.1.tgz",
};
export const STREAM_CHANNEL_ARCHIVE_INTEGRITIES: Readonly<Record<string, string>> = {
  "stream-chat":
    "sha512-zvl/4e8kJTOEi3BJjTTnxwEVh4Rv8tQtZqf0J4L1pZPsWjkzQ/QP39gEAqVfulhXrDWzGe4xVfaiJBmMGRGHlw==",
  "stream-chat-react":
    "sha512-76R4S2zdroRGkV0438pYQZXEIP22cIirHUIa9bI/9ulMoCyodHGphjWCyt7pr37Qqc4TGX1ooUwfeW7QmogNqw==",
};
export const STREAM_CHANNEL_PROVIDER_SOURCES = [
  "stream-chat",
  "stream-chat-react",
  "stream-chat-react/dist/css/index.css",
];
export const STREAM_CHANNEL_MUTATION_METHODS: ReadonlySet<string> = new Set([
  "update",
  "addMembers",
]);
export const STREAM_CHANNEL_MUTATION_ARGUMENT_LIMIT: Readonly<Record<string, number>> = {
  update: 3,
  addMembers: 2,
};
export const STREAM_CHANNEL_ALLOWED_API_NAMES: ReadonlySet<string> = new Set([
  "StreamChat",
  "Chat",
  "Channel",
  "ChannelList",
  "Avatar",
  "MessageTeam",
  "MessageList",
  "MessageInput",
  "Thread",
  "Window",
  "useChatContext",
  "useChannelStateContext",
  "useChannelActionContext",
  "useMessageContext",
]);
export const STREAM_CHANNEL_SCALAR_PROPERTIES: ReadonlySet<string> = new Set([
  "data",
  "id",
  "cid",
  "type",
  "state",
  "user",
  "userID",
  "getConfig",
  "countUnread",
  "watch",
  "queryUsers",
  "connectUser",
  "queryChannels",
  "channel",
]);

export const STREAM_CHANNEL_LOCK_VERSION = 1;
export const STREAM_CHANNEL_CHANNEL_LIST_PROP_NAMES: ReadonlySet<string> = new Set([
  "filters",
  "sort",
  "options",
  "channelRenderFilterFn",
  "List",
  "Preview",
  "watchers",
  "setActiveChannelOnMount",
]);
