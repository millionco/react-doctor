export const DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT = 1;
export const DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT = 2;
export const DEFERRED_IFRAME_CLASS_MATCH_INDEX = 1;
export const DEFERRED_IFRAME_SELECTOR_PATTERN = /^\.([A-Za-z_][\w-]*) > iframe$/u;
export const DEFERRED_IFRAME_ID_PATTERN = /^#[A-Za-z_][\w-]*$/u;
export const DEFERRED_IFRAME_EXTERNAL_PREFIX_PATTERN =
  /^https:\/\/[^\s/?#@]+(?:\.[^\s/?#@]+)+(?:\/[^\s]*)$/u;
export const DEFERRED_IFRAME_FORBIDDEN_NODES: ReadonlySet<string> = new Set([
  "ImportExpression",
  "WithStatement",
  "ThisExpression",
  "NewExpression",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSModuleDeclaration",
  "StaticBlock",
  "PropertyDefinition",
  "AccessorProperty",
]);
export const DEFERRED_IFRAME_CAPABILITY_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "Proxy",
  "Symbol",
  "globalThis",
  "global",
  "self",
  "require",
  "module",
  "exports",
  "arguments",
  "setTimeout",
  "setInterval",
]);
export const DEFERRED_IFRAME_CAPABILITY_MEMBERS: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "caller",
  "callee",
  "arguments",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "createElement",
  "createElementNS",
  "insertAdjacentHTML",
  "append",
  "appendChild",
  "prepend",
  "insertBefore",
  "replaceChild",
  "replaceChildren",
  "outerHTML",
  "dangerouslySetInnerHTML",
  "setPrototypeOf",
  "defineProperty",
  "defineProperties",
  "textContent",
  "innerText",
  "remove",
  "replaceWith",
]);
export const DEFERRED_IFRAME_DOCUMENT_METHODS: ReadonlySet<string> = new Set([
  "querySelector",
  "getElementById",
  "addEventListener",
  "removeEventListener",
]);
export const DEFERRED_IFRAME_WINDOW_METHODS: ReadonlySet<string> = new Set([
  "addEventListener",
  "removeEventListener",
  "scrollTo",
]);
export const DEFERRED_IFRAME_PROP_TYPE_NAMES: ReadonlySet<string> = new Set([
  "bool",
  "func",
  "string",
]);
export const DEFERRED_IFRAME_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "document",
  "window",
  "console",
  "undefined",
  "NaN",
  "Infinity",
]);

export const DEFERRED_IFRAME_MAX_EVENT_FORWARDING_DEPTH = 3;
export const DEFERRED_IFRAME_REACT_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useRef",
  "useState",
  "useEffect",
  "useCallback",
]);

export const DEFERRED_IFRAME_HTML_ID_PATTERN = /\bid\s*=\s*["']([^"']*)["']/giu;

export const DEFERRED_IFRAME_HTML_ID_START_PATTERN = /\bid\s*=/giu;
export const DEFERRED_IFRAME_HTML_ACTIVE_PATTERN = /<\s*script\b|\bon[a-z]+\s*=|javascript\s*:/iu;

export const DEFERRED_IFRAME_MAX_RENDER_FORWARDING_DEPTH = 8;
export const DEFERRED_IFRAME_INACTIVE_RENDER_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "title",
  "noembed",
  "noframes",
  "plaintext",
  "xmp",
]);

export const DEFERRED_IFRAME_SINGLE_CARRIER_COUNT = 1;

export const DEFERRED_IFRAME_MAX_WORK_GROWTH_RATIO = 6;

export const DEFERRED_IFRAME_SINGLE_SOURCE_QUERY_COUNT = 1;
