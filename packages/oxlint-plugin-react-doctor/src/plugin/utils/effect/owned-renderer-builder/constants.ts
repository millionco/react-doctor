export const OWNED_RENDERER_BUILDER_VOID_ZERO_LITERAL_VALUE = 0;
export const OWNED_RENDERER_BUILDER_CONTAINER_COUNT = 1;
export const OWNED_RENDERER_BUILDER_RESULT_FIELD_COUNT = 2;
export const OWNED_RENDERER_BUILDER_INTRINSIC_NAMES = new Set([
  "Map",
  "Array",
  "eval",
  "Function",
  "String",
  "RegExp",
]);
export const OWNED_RENDERER_BUILDER_INTRINSIC_MEMBERS = new Set([
  "Map",
  "Array",
  "String",
  "RegExp",
  "get",
  "set",
  "push",
  "trim",
  "replace",
  "toLowerCase",
  "startsWith",
  "test",
]);
export const OWNED_RENDERER_BUILDER_UNSUPPORTED_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
]);
export const OWNED_RENDERER_BUILDER_TOKEN_FIELDS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  link: { href: "string" },
  image: { href: "string", text: "string", title: "nullable-string" },
  code: { type: "string", raw: "string", text: "string" },
  heading: {
    type: "string",
    raw: "string",
    text: "string",
    depth: "number",
    tokens: "token-array",
  },
  paragraph: { type: "string", raw: "string", text: "string", tokens: "token-array" },
};
export const OWNED_RENDERER_BUILDER_READONLY_STATICS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  Array: new Set(["from", "of", "isArray"]),
  Map: new Set(["groupBy"]),
  String: new Set(["fromCharCode", "fromCodePoint", "raw"]),
};
