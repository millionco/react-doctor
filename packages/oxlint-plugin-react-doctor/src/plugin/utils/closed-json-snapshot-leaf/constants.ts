export const CLOSED_JSON_SNAPSHOT_LEAF_MAX_DEPTH = 12;
export const CLOSED_JSON_SNAPSHOT_LEAF_MAX_REFERENCES = 256;
export const CLOSED_JSON_SNAPSHOT_ROUTER_COMPONENT_NAMES: ReadonlySet<string> = new Set([
  "Route",
  "Switch",
  "BrowserRouter",
]);
export const CLOSED_JSON_SNAPSHOT_TEXT_TAGS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "span",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "b",
  "i",
  "em",
  "strong",
  "small",
  "mark",
  "code",
  "samp",
  "kbd",
  "sup",
  "sub",
  "section",
  "article",
  "main",
  "aside",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
]);
export const CLOSED_JSON_SNAPSHOT_UNSUPPORTED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "children",
  "dangerouslySetInnerHTML",
  "srcDoc",
]);
export const CLOSED_JSON_SNAPSHOT_ORDINAL_OPERATORS: ReadonlySet<string> = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
]);
export const CLOSED_JSON_SNAPSHOT_PROTOTYPE_PROPERTIES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
]);
