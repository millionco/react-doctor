export const SHOPIFY_API_MODULE = "@shopify/shopify-api";
export const SHOPIFY_NODE_ADAPTER_MODULE = "@shopify/shopify-api/adapters/node";
export const SHOPIFY_VALIDATION_ARGUMENT_COUNT = 1;
export const SHOPIFY_VALIDATION_PARAMETER_COUNT = 2;
export const SHOPIFY_RAW_ARGUMENT_COUNT = 3;
export const SHOPIFY_INVALID_STATUS_CODE = 400;
export const SHOPIFY_ERROR_STATUS_CODE = 500;
export const SHOPIFY_FIRST_STATEMENT_INDEX = 0;
export const SHOPIFY_GATE_STATEMENT_INDEX = 1;
export const SHOPIFY_SELF_EXTENSION_PROPERTY_COUNT = 2;
export const SHOPIFY_MAX_DATA_DEPTH = 24;
export const SHOPIFY_FORBIDDEN_SELECTORS = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
]);
export const SHOPIFY_FORBIDDEN_RUNTIME_NAMES = new Set([
  "eval",
  "Function",
  "require",
  "globalThis",
  "global",
  "window",
  "Reflect",
  "Object",
  "String",
  "Proxy",
  "Symbol",
]);
export const SHOPIFY_RAW_REPLACE_ARGUMENT_COUNT = 2;
