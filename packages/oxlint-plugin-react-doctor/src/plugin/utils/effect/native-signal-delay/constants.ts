export const NATIVE_DELAY_MAX_ALIAS_DEPTH = 32;
export const NATIVE_DELAY_MAX_SCOPE_ANCESTRY_DEPTH = 32;
export const NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT = 32;
export const NATIVE_DELAY_MAX_PROGRAM_NODES = 50_000;
export const PRIVATE_PRIMITIVE_ARRAY_MAX_WORK_STEPS = NATIVE_DELAY_MAX_PROGRAM_NODES;
export const PRIVATE_PRIMITIVE_ARRAY_INDEX_INCREMENT = 1;
export const PRIVATE_PRIMITIVE_ARRAY_REF_ARGUMENT_COUNT = 1;
export const NATIVE_DELAY_EXECUTOR_STATEMENT_COUNT = 4;
export const NATIVE_DELAY_SETTLEMENT_STATEMENT_COUNT = 2;
export const NATIVE_DELAY_MAX_ABORT_STATEMENT_COUNT = 3;
export const NATIVE_DELAY_MAX_ARGUMENT_COUNT = 2;
export const NATIVE_DELAY_REFLECT_SET_ARGUMENT_COUNT = 3;
export const NATIVE_DELAY_REFLECT_DELETE_ARGUMENT_COUNT = 2;
export const NATIVE_DELAY_GLOBAL_NAMES = [
  "Promise",
  "setTimeout",
  "clearTimeout",
  "AbortController",
  "AbortSignal",
  "EventTarget",
];
export const NATIVE_DELAY_GLOBAL_SELF_NAMES = ["window", "self", "global", "globalThis"];
export const NATIVE_DELAY_DYNAMIC_CODE_GLOBAL_NAMES = ["eval", "Function"];
export const NATIVE_DELAY_UNOWNED_WINDOW_GLOBAL_NAMES = [
  "parent",
  "top",
  "opener",
  "frames",
  "open",
];
export const NATIVE_DELAY_PROTOTYPE_NAMES = new Set([
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
]);
export const NATIVE_DELAY_PROTECTED_MEMBER_NAMES = new Set([
  ...NATIVE_DELAY_GLOBAL_NAMES,
  ...NATIVE_DELAY_GLOBAL_SELF_NAMES,
  ...NATIVE_DELAY_PROTOTYPE_NAMES,
  "Object",
  "Reflect",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "abort",
  "aborted",
  "signal",
  "constructor",
  "then",
  "catch",
  "finally",
  "resolve",
  "reject",
  "assign",
  "defineProperty",
  "defineProperties",
  "set",
  "deleteProperty",
]);
export const NATIVE_DELAY_OBJECT_MUTATION_METHODS = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
]);
export const NATIVE_DELAY_REFLECT_MUTATION_METHODS = new Set([
  "set",
  "defineProperty",
  "deleteProperty",
]);
export const NATIVE_DELAY_SAFE_STATIC_METHODS: Readonly<Record<string, ReadonlySet<string>>> = {
  Promise: new Set([
    "all",
    "allSettled",
    "any",
    "race",
    "reject",
    "resolve",
    "withResolvers",
    "try",
  ]),
  AbortSignal: new Set(["abort", "any", "timeout"]),
};
