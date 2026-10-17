export const OWNER_STATE_TUPLE_LENGTH = 2;
export const OWNER_RENDER_REFRESH_COUNT = 1;
export const DIRECT_HOOK_ARGUMENT_COUNT = 1;
export const CALLBACK_HOOK_ARGUMENT_COUNT = 2;
export const SINGLE_EXIT_STATEMENT_COUNT = 1;
export const REACT_OWNER_API_NAMES: ReadonlySet<string> = new Set([
  "useState",
  "useRef",
  "useCallback",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useReducer",
]);
export const UNSUPPORTED_OWNER_PROGRAM_NODE_TYPES: ReadonlySet<string> = new Set([
  "WithStatement",
  "ImportExpression",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSInstantiationExpression",
]);
export const UNSUPPORTED_OWNER_REGION_NODE_TYPES: ReadonlySet<string> = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "YieldExpression",
]);
export const UNSUPPORTED_OWNER_WINDOW_NODE_TYPES: ReadonlySet<string> = new Set([
  "AwaitExpression",
  "YieldExpression",
  "CallExpression",
  "NewExpression",
  "TaggedTemplateExpression",
  "AssignmentExpression",
  "UpdateExpression",
  "TryStatement",
  "ThrowStatement",
]);
export const UNSUPPORTED_OWNER_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "__defineGetter__",
  "__defineSetter__",
]);
export const UNSUPPORTED_OWNER_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "require",
  "Function",
  "globalThis",
  "window",
  "global",
  "self",
  "Reflect",
  "Proxy",
]);
