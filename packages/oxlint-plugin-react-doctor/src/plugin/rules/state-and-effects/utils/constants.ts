import { VOID_DOM_ELEMENTS } from "../../../constants/html-tags.js";

export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

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
