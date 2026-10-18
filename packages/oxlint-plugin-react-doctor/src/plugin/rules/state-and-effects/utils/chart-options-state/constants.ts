export const CHART_STATE_TUPLE_LENGTH = 2;
export const CHART_HOOK_ARGUMENT_COUNT = 2;
export const CHART_CONSTRUCTOR_ARGUMENT_COUNT = 2;
export const CHART_SETTER_ARGUMENT_COUNT = 1;
export const CHART_SINGLE_DECLARATOR_COUNT = 1;
export const CHART_EMPTY_ARGUMENT_COUNT = 0;
export const CHART_CONSTRUCTION_TAIL_STATEMENT_COUNT = 3;
export const CHART_UPDATE_MIN_STATEMENT_COUNT = 3;
export const CHART_OPTIONS_COLOR_PATHS = new Set([
  "options.plugins.tooltip.titleColor",
  "options.plugins.tooltip.bodyColor",
  "options.plugins.tooltip.backgroundColor",
  "options.plugins.tooltip.borderColor",
  "options.scales.x.ticks.color",
  "options.scales.y.ticks.color",
  "options.scales.x.grid.color",
  "options.scales.y.grid.color",
]);
export const CHART_UNSUPPORTED_PROVIDER_MODULES = new Set([
  "preact",
  "pure-preact",
  "preact/compat",
  "react-native",
  "expo",
  "module",
  "node:module",
  "process",
  "node:process",
  "vm",
  "node:vm",
  "repl",
  "node:repl",
  "inspector",
  "node:inspector",
  "inspector/promises",
  "node:inspector/promises",
]);
export const CHART_UNSUPPORTED_GLOBAL_NAMES = new Set([
  "eval",
  "Function",
  "require",
  "module",
  "process",
  "globalThis",
  "global",
  "window",
  "self",
  "Reflect",
  "Proxy",
]);
export const CHART_UNSUPPORTED_NODE_TYPES = new Set([
  "WithStatement",
  "ImportExpression",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSDeclareFunction",
]);
export const CHART_DATA_EXPRESSION_TYPES = new Set([
  "Identifier",
  "Literal",
  "MemberExpression",
  "ConditionalExpression",
  "LogicalExpression",
  "BinaryExpression",
  "UnaryExpression",
  "TemplateLiteral",
  "TemplateElement",
]);

export const CHART_INCOMPATIBLE_CAPABILITIES = new Set([
  "preact",
  "pure-preact",
  "react-native",
  "react-compiler",
  "expo",
]);
