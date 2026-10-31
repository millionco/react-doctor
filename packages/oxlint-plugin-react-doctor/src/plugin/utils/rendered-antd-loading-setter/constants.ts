export const LOADING_STATE_TUPLE_LENGTH = 2;
export const LOADING_STATE_INITIALIZER_ARGUMENT_COUNT = 1;
export const UNIQUE_LOADING_ATTRIBUTE_COUNT = 1;
export const REACT_VALUE_API_NAMES: ReadonlySet<string> = new Set([
  "useState",
  "useEffect",
  "useLayoutEffect",
  "useCallback",
  "useMemo",
  "useRef",
]);
export const UNSUPPORTED_LOADING_ROLE_NODE_TYPES: ReadonlySet<string> = new Set([
  "WithStatement",
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
export const ALWAYS_TRUTHY_LOADING_SELECTOR_NODE_TYPES: ReadonlySet<string> = new Set([
  "JSXElement",
  "JSXFragment",
  "ArrayExpression",
  "ObjectExpression",
  "ArrowFunctionExpression",
  "FunctionExpression",
  "ClassExpression",
  "NewExpression",
]);
