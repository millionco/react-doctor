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
