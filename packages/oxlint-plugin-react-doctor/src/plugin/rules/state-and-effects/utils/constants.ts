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
