export const OPTIONAL_FACTORY_METHOD_NAMES = new Set(["from", "some", "none"]);
export const OPTIONAL_WRAPPER_METHOD_NAMES = new Set(["map", "filter"]);
export const OPTIONAL_PROVIDER_MUTATION_METHOD_NAMES = new Set([
  "from",
  "some",
  "none",
  "map",
  "filter",
  "bind",
  "firstChild",
  "prototype",
]);
export const OPTIONAL_PROVIDER_HAZARD_NAMES = [
  "Object",
  "Reflect",
  "eval",
  "Function",
  "require",
  "module",
];
export const OPTIONAL_SINGLE_ARGUMENT_COUNT = 1;
export const OPTIONAL_NO_ARGUMENT_COUNT = 0;
export const OPTIONAL_BINDER_METHOD_NAMES = new Set(["firstChild"]);
