export const SINGLE_LITERAL_STAR_PATTERN =
  /^(?:\^[A-Za-z0-9 :,_#@%&=;!~]\*|[A-Za-z0-9 :,_#@%&=;!~]\*\$)$/;
export const NON_STATEFUL_REGEX_FLAGS = /^[dimsuv]*$/;
export const SINGLE_REGEX_ARGUMENT_COUNT = 1;
export const SINGLE_SELECTED_TYPE_PROPERTY_COUNT = 1;
export const REGEX_RESULT_PROVIDER_NAMES = ["String", "RegExp"];
export const REGEX_GLOBAL_EXPOSED_PROPERTY_NAMES = new Set([
  ...REGEX_RESULT_PROVIDER_NAMES,
  "window",
  "globalThis",
  "self",
  "global",
  "constructor",
  "__proto__",
  "prototype",
]);
