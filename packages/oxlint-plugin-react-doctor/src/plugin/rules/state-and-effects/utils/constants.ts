import { VOID_DOM_ELEMENTS } from "../../../constants/html-tags.js";

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

export const IMPERATIVE_COMMAND_SINGLE_FRAME_COUNT = 1;
export const IMPERATIVE_COMMAND_ADJACENT_OFFSETS = [-1, 1];
export const IMPERATIVE_COMMAND_PROVIDER_HAZARD_NAMES = [
  "React",
  "eval",
  "Function",
  "require",
  "module",
  "Object",
  "Reflect",
];
export const IMPERATIVE_COMMAND_UNSUPPORTED_FRAME_NODES = new Set([
  "TryStatement",
  "SwitchStatement",
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
  "LabeledStatement",
  "BreakStatement",
  "ContinueStatement",
  "ThisExpression",
]);

export const EFFECT_GENERATION_COUNTER_INITIAL_VALUE = 0;
export const EFFECT_REF_INITIALIZER_ARGUMENT_COUNT = 1;
export const EFFECT_CALLBACK_HOLDER_DEPENDENCY_COUNT = 1;
export const VITE_ENVIRONMENT_VARIABLE_PREFIX = "VITE_";

export const NATIVE_EMITTER_ARGUMENT_COUNT = 2;

export const NATIVE_EMITTER_EXPOSED_GLOBAL_NAMES = new Set([
  "global",
  "globalThis",
  "Object",
  "Reflect",
  "eval",
  "Function",
  "require",
  "module",
]);

export const NATIVE_EMITTER_EXPOSED_PROPERTY_NAMES = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

export const NATIVE_EMITTER_UNSUPPORTED_CLEANUP_TYPES = new Set([
  "TryStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "LabeledStatement",
  "BreakStatement",
  "ContinueStatement",
]);

export const NATIVE_EMITTER_MODULE_CARRIER_NAMES = new Set(["module", "node:module"]);

export const NATIVE_EMITTER_INHERITED_REACT_METHOD_NAMES = new Set(["setState", "forceUpdate"]);

export const NATIVE_EMITTER_REACT_MAX_ARGUMENT_COUNT = 2;

export const PLATFORM_SUBSCRIPTION_ARGUMENT_COUNT = 2;

export const PLATFORM_SUBSCRIPTION_OS_VALUES = new Set(["ios", "android"]);

export const PLATFORM_SUBSCRIPTION_NATIVE_METHODS = new Set(["setState", "forceUpdate"]);

export const PLATFORM_SUBSCRIPTION_EXPOSED_GLOBALS = new Set([
  "React",
  "Object",
  "Reflect",
  "Array",
  "Proxy",
  "eval",
  "Function",
  "module",
  "global",
  "globalThis",
  "window",
  "self",
]);

export const PLATFORM_SUBSCRIPTION_EXPOSED_PROPERTIES = new Set(["constructor", "__proto__"]);

export const PLATFORM_SUBSCRIPTION_ASSET_PATTERN = /^\.{1,2}\/.+\.(?:png|jpe?g|gif|webp)$/i;

export const PLATFORM_SUBSCRIPTION_ASSET_ARGUMENT_COUNT = 1;

export const PLATFORM_SUBSCRIPTION_BIND_ARGUMENT_COUNT = 1;

export const PLATFORM_SUBSCRIPTION_HELPER_STATEMENT_COUNT = 1;

export const PLATFORM_SUBSCRIPTION_REACT_MAX_ARGUMENT_COUNT = 2;

export const PLATFORM_SUBSCRIPTION_UNSUPPORTED_TS_RUNTIME_TYPES = new Set([
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
]);

export const NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT = 1;

export const NEXT_PAGE_REDIRECT_PROVIDER_MODULES = new Set(["react", "next/router"]);

export const NEXT_PAGE_REDIRECT_LOADER_MODULES = new Set(["module", "node:module"]);

export const NEXT_PAGE_REDIRECT_DYNAMIC_GLOBALS = new Set([
  "eval",
  "Function",
  "require",
  "module",
  "React",
]);

export const NEXT_PAGE_REDIRECT_GLOBAL_OBJECTS = new Set([
  "global",
  "globalThis",
  "window",
  "self",
  "frames",
  "top",
  "parent",
  "opener",
]);

export const NEXT_PAGE_REDIRECT_EXPOSED_PROPERTIES = new Set([
  "constructor",
  "prototype",
  "__proto__",
]);

export const NEXT_PAGE_REDIRECT_RUNTIME_TYPES = new Set([
  "TSImportEqualsDeclaration",
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

export const NEXT_PAGE_REDIRECT_EFFECT_ARGUMENT_COUNT = 2;

export const NEXT_PAGE_REDIRECT_PAGE_FILE_PATTERN =
  /^(?:src\/)?pages\/(?!api\/|_(?:app|document|error)\.).+\.[jt]sx?$/;

export const DISABLING_STATE_TUPLE_SLOT_COUNT = 2;

export const DISABLING_STATE_SETTER_NAME_PATTERN = /disabling/i;

export const DISABLING_STATE_UNSUPPORTED_PROVIDER_GLOBAL_NAMES = new Set([
  "React",
  "require",
  "module",
  "eval",
  "Function",
  "globalThis",
  "window",
  "self",
  "global",
]);

export const FRAME_CANCELLATION_RECEIVER_NAMES = new Set(["window", "globalThis", "self"]);

export const FRAME_CANCELLATION_EXPOSED_PROPERTY_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "window",
  "globalThis",
  "self",
  "global",
  "top",
  "parent",
  "frames",
]);

export const KEYED_RECORD_RESET_UNSUPPORTED_GLOBAL_NAMES = new Set([
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "Object",
  "require",
  "module",
  "process",
  "globalThis",
  "window",
]);

export const KEYED_RECORD_RESET_UNSUPPORTED_MODULE_NAMES = new Set([
  "module",
  "node:module",
  "process",
  "node:process",
  "vm",
  "node:vm",
  "repl",
  "node:repl",
  "inspector",
  "node:inspector",
  "inspector/promises",
  "node:inspector/promises",
]);

export const KEYED_RECORD_RESET_POSSIBLE_JSX_DIRECTIVE_PATTERN =
  /@jsx(?:ImportSource|Runtime)?(?:\s|$)/;

export const KEYED_RECORD_RESET_JSX_DIRECTIVE_PATTERN =
  /(?:^|\s)@(jsx|jsxImportSource|jsxRuntime)\s+([^\s*]+)/g;

export const KEYED_RECORD_RESET_PRIMITIVE_FIELD_TYPES: ReadonlySet<string> = new Set([
  "TSStringKeyword",
  "TSNumberKeyword",
  "TSBooleanKeyword",
  "TSBigIntKeyword",
  "TSSymbolKeyword",
  "TSNullKeyword",
  "TSUndefinedKeyword",
  "TSNeverKeyword",
  "TSTemplateLiteralType",
]);

export const NATIVE_EVENT_WRITER_INACTIVE_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "disabled",
  "inert",
  "hidden",
  "aria-disabled",
  "is",
]);

export const NATIVE_EVENT_WRITER_INACTIVE_ANCESTOR_TAG_NAMES: ReadonlySet<string> = new Set([
  "template",
  "iframe",
]);

export const NATIVE_EVENT_WRITER_UNSUPPORTED_ANCESTOR_TAG_NAMES: ReadonlySet<string> = new Set([
  ...VOID_DOM_ELEMENTS,
  "noscript",
  "textarea",
  "title",
  "style",
  "script",
]);

export const NATIVE_EVENT_WRITER_RUNTIME_TYPESCRIPT_NODES: ReadonlySet<string> = new Set([
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSParameterProperty",
]);

export const NATIVE_EVENT_WRITER_UNSUPPORTED_IDENTIFIERS: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Reflect",
  "Object",
  "globalThis",
  "window",
  "self",
  "arguments",
  "require",
  "module",
]);

export const NATIVE_EVENT_WRITER_UNSUPPORTED_MEMBERS: ReadonlySet<string> = new Set([
  "React",
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);

export const NATIVE_EVENT_WRITER_EVENT_NAMES: ReadonlySet<string> = new Set(["onClick"]);

export const NATIVE_EVENT_WRITER_UNSUPPORTED_CONTROL_FLOW_NODES: ReadonlySet<string> = new Set([
  "ConditionalExpression",
  "LogicalExpression",
  "TryStatement",
  "CatchClause",
  "SwitchStatement",
  "SwitchCase",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

export const NATIVE_EVENT_WRITER_UNSUPPORTED_COMPONENT_CONTROL_FLOW_NODES: ReadonlySet<string> =
  new Set([
    "IfStatement",
    "ForStatement",
    "ForInStatement",
    "ForOfStatement",
    "WhileStatement",
    "DoWhileStatement",
    "TryStatement",
    "CatchClause",
    "SwitchStatement",
    "SwitchCase",
    "ThrowStatement",
    "AwaitExpression",
    "YieldExpression",
  ]);

export const SDK_SNAPSHOT_SUPPORTED_VERSION = {
  major: 2,
  minor: 34,
  patch: 0,
  isPrerelease: false,
};

export const SDK_SNAPSHOT_DECLARED_RANGE = "^2.34.0";

export const SDK_SNAPSHOT_UNSUPPORTED_IDENTIFIERS = new Set([
  "eval",
  "Function",
  "require",
  "React",
  "Twilio",
  "EventEmitter",
  "Reflect",
  "Object",
  "globalThis",
  "global",
  "window",
  "self",
  "arguments",
  "module",
]);

export const SDK_SNAPSHOT_UNSUPPORTED_MEMBERS = new Set([
  "React",
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);

export const SDK_SNAPSHOT_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumMember",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
]);

export const SLATE_CURRENT_FOCUS_SUPPORTED_VERSION = {
  major: 0,
  minor: 126,
  patch: 0,
  isPrerelease: false,
};

export const SLATE_CURRENT_FOCUS_DECLARED_RANGE = "^0.126.0";

export const SLATE_CURRENT_FOCUS_UNSUPPORTED_IDENTIFIERS = new Set([
  "eval",
  "Function",
  "require",
  "Reflect",
  "globalThis",
  "global",
  "window",
  "self",
  "module",
  "arguments",
]);

export const SLATE_CURRENT_FOCUS_UNSUPPORTED_MEMBERS = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);

export const SLATE_CURRENT_FOCUS_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumMember",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
]);

export const FOCUS_REQUEST_TOP_LEVEL_STATEMENT_COUNT = 3;

export const FOCUS_REQUEST_GUARDED_STATEMENT_COUNT = 5;

export const FOCUS_REQUEST_DEPENDENCY_COUNT = 2;

export const FOCUS_REQUEST_MAP_REFERENCE_COUNT = 3;

export const FOCUS_REQUEST_SETTER_REFERENCE_COUNT = 2;

export const FOCUS_REQUEST_WRITER_STATEMENT_COUNT = 2;

export const FOCUS_REQUEST_UNSUPPORTED_GLOBALS: ReadonlySet<string> = new Set([
  "document",
  "process",
  "global",
  "Proxy",
  "customElements",
]);

export const FOCUS_REQUEST_UNSUPPORTED_PROPERTIES: ReadonlySet<string> = new Set([
  "map",
  "filter",
  "join",
  "indexOf",
  "length",
  "valueOf",
  "toString",
  "toPrimitive",
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
]);

export const FOCUS_REQUEST_UNSUPPORTED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "onFocus",
  "onFocusCapture",
  "onBlur",
  "onBlurCapture",
  "is",
  "dangerouslySetInnerHTML",
  "srcDoc",
]);

export const FOCUS_REQUEST_ARRAY_READ_METHODS: ReadonlySet<string> = new Set([
  "map",
  "filter",
  "join",
]);

export const FOCUS_REQUEST_PASSIVE_FETCHER_FIELDS: ReadonlySet<string> = new Set(["data", "state"]);

export const READINESS_PROTOCOL_ARGUMENT_COUNT = 2;

export const READINESS_SEND_AND_CONSUME_STATEMENT_COUNT = 2;

export const READINESS_SINGLE_VALUE_COUNT = 1;

export const READINESS_MESSAGE_LISTENER_ARGUMENT_COUNT = 3;

export const READINESS_CAPABILITY_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "globalThis",
  "global",
  "self",
  "require",
  "module",
  "exports",
  "process",
  "Proxy",
  "Array",
  "EventTarget",
  "MessageEvent",
  "Window",
  "HTMLIFrameElement",
  "document",
]);

export const READINESS_MEMBER_CAPABILITIES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
]);

export const READINESS_RUNTIME_TYPESCRIPT: ReadonlySet<string> = new Set([
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSModuleDeclaration",
]);

export const READINESS_NATIVE_IFRAME_ATTRIBUTES: ReadonlySet<string> = new Set([
  "ref",
  "src",
  "style",
  "title",
  "hidden",
  "sandbox",
]);

export const READINESS_SOURCE_GUARD_STATEMENT_COUNT = 2;

export const READINESS_INACTIVE_IFRAME_CONTAINERS: ReadonlySet<string> = new Set([
  "noembed",
  "noframes",
  "plaintext",
  "xmp",
  "iframe",
  "math",
  "noscript",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
]);
