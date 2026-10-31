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

export const MIRROR_STATE_ARGUMENT_COUNT = 1;
export const MIRROR_EFFECT_ARGUMENT_COUNT = 2;

export const NATIVE_TRANSITION_TUPLE_ELEMENT_COUNT = 2;
export const NATIVE_TRANSITION_ACTION_INDEX = 1;
export const NATIVE_TRANSITION_CALL_ARGUMENT_COUNT = 1;
export const NATIVE_TRANSITION_TUPLE_PROVIDER_NAMES = ["Array", "Symbol"];

export const NATIVE_TRANSITION_GLOBAL_CARRIER_PROPERTY_NAMES = new Set([
  "global",
  "globalThis",
  "self",
  "window",
  "frames",
  "parent",
  "top",
  "opener",
]);

export const THREE_REF_SINGLE_ARGUMENT_COUNT = 1;
export const THREE_REF_EFFECT_ARGUMENT_COUNT = 2;
export const THREE_REF_FIRST_ARGUMENT_INDEX = 0;
export const THREE_REF_DEPENDENCY_ARGUMENT_INDEX = 1;
export const THREE_REF_EMPTY_COUNT = 0;
export const THREE_REF_EXPOSED_GLOBAL_NAMES = new Set([
  "Object",
  "Reflect",
  "Array",
  "global",
  "globalThis",
  "window",
  "self",
  "eval",
  "Function",
  "require",
  "module",
]);
export const THREE_REF_EXPOSED_PROPERTY_NAMES = new Set(["prototype", "constructor", "__proto__"]);
export const THREE_REF_LOADER_MODULES = new Set(["module", "node:module"]);
export const THREE_REF_REACT_APIS = new Set(["useRef", "useEffect"]);
export const THREE_REF_FIBER_APIS = new Set(["useThree", "useFrame"]);
export const THREE_REF_VECTOR_PROPERTIES = new Set(["position", "scale"]);
export const THREE_REF_CHILD_CONSTRUCTORS = new Set(["Group", "ArrowHelper"]);

export const NATIVE_CALLBACK_HOOK_ARGUMENT_COUNT = 2;

export const NATIVE_EFFECT_CALLBACK_PARAMETER_COUNT = 0;

export const NATIVE_REACT_PROVIDER_HAZARD_NAMES = [
  "React",
  "eval",
  "Function",
  "require",
  "module",
  "Object",
  "Reflect",
];

export const MAX_BODY_ARRAY_MIRROR_TYPE_DEPTH = 32;

export const BODY_ARRAY_MIRROR_UNSUPPORTED_NAMES = new Set([
  "eval",
  "Function",
  "require",
  "module",
  "process",
  "globalThis",
  "window",
]);

export const BODY_ARRAY_MIRROR_REFLECTION_METHODS = new Set([
  "defineProperty",
  "defineProperties",
  "set",
  "setPrototypeOf",
  "getPrototypeOf",
]);

export const BODY_ARRAY_MIRROR_UNSUPPORTED_MODULES = new Set([
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

export const BODY_ARRAY_MIRROR_READONLY_REACT_APIS = new Set(["createRef", "isValidElement"]);

export const FLICKITY_POSSIBLE_JSX_DIRECTIVE_PATTERN = /@jsx(?:ImportSource|Runtime)?(?:\s|$)/;

export const FLICKITY_JSX_DIRECTIVE_PATTERN =
  /(?:^|\s)@(jsx|jsxImportSource|jsxRuntime)\s+([^\s*]+)/g;
