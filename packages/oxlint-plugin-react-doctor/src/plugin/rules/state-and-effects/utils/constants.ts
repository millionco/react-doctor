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

export const RADIX_DRAFT_INHERITED_OBJECT_KEYS: ReadonlySet<string> = new Set([
  "constructor",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);
