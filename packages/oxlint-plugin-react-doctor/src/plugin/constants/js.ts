export const LOOP_TYPES = [
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
];

// Built-in JS globals whose method calls (`Math.floor(x)`,
// `Date.now()`, `JSON.parse(x)`, …) are not reactive reads and don't
// count as "expensive derivations". The chain root is what matters —
// `Math.floor(raw)` should only treat `raw` as a reactive read, and
// the call itself should be classified as trivial regardless of which
// method is invoked.
export const BUILTIN_GLOBAL_NAMESPACE_NAMES = new Set([
  "Math",
  "Date",
  "JSON",
  "Object",
  "Array",
  "Number",
  "String",
  "Boolean",
  "RegExp",
  "Symbol",
  "BigInt",
  "Reflect",
]);

// In-place Array.prototype mutators. These are the canonical "mutating"
// methods used to flag direct mutation of useState values (e.g. an
// `items` from `useState([])` that gets `.push()`ed). The immutable
// counterparts (toSorted/toReversed/toSpliced/with) are intentionally
// excluded; those return a new array.
export const MUTATING_ARRAY_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

export const CHAINABLE_ITERATION_METHODS = new Set(["map", "filter", "forEach", "flatMap"]);

export const TEST_FILE_PATTERN = /\.(?:test|spec|stories)\.[tj]sx?$/;
