export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

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
