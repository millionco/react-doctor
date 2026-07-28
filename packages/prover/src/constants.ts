import { ReactEffectResourceKind } from "./types.js";

export const REACT_PROOF_SCHEMA_VERSION = 19;
export const REACT_SEMANTIC_GRAPH_SCHEMA_VERSION = 25;
export const REACT_COMPILER_VERSION = "babel-plugin-react-compiler@1.0.0";
export const REACT_COMPILER_FACT_PHASE = "InferReactivePlaces";
export const FIRST_SOURCE_LINE = 1;
export const FIRST_SOURCE_COLUMN = 1;
export const PROVER_RUNTIME_ORACLE_PORT = 4178;
export const PROVER_RUNTIME_ORACLE_TIMEOUT_MS = 30_000;
export const REACT_CONTEXT_DEFAULT_SOURCE_ID = "react:context-default";
export const REACT_OPTIMISTIC_REDUCER_INDEX = 1;
export const REACT_OPTIMISTIC_SETTER_INDEX = 1;
export const REACT_OPTIMISTIC_STATE_INDEX = 0;
export const REACT_OPTIMISTIC_TUPLE_LENGTH = 2;
export const REACT_TRANSITION_ACTION_INDEX = 0;
export const REACT_TRANSITION_STARTER_INDEX = 1;
export const REACT_USE_TRANSITION_TUPLE_LENGTH = 2;

export const REACT_EFFECT_HOOK_NAMES = new Set([
  "useEffect",
  "useInsertionEffect",
  "useLayoutEffect",
]);

export const PLATFORM_OBSERVER_KINDS = new Map<string, ReactEffectResourceKind>([
  ["IntersectionObserver", ReactEffectResourceKind.IntersectionObserver],
  ["MutationObserver", ReactEffectResourceKind.MutationObserver],
  ["ResizeObserver", ReactEffectResourceKind.ResizeObserver],
]);

export const REACT_MEMO_HOOK_NAMES = new Set(["useCallback", "useMemo"]);
export const REACT_REDUCER_HOOK_NAMES = new Set(["useReducer"]);
export const REACT_EXTERNAL_STORE_HOOK_NAMES = new Set(["useSyncExternalStore"]);
export const EFFECT_EVENT_REGISTRATION_CALL_NAMES = new Set([
  "addEventListener",
  "on",
  "once",
  "removeEventListener",
  "requestAnimationFrame",
  "setInterval",
  "setTimeout",
  "subscribe",
]);
export const PROMISE_CONTINUATION_METHOD_NAMES = new Set(["catch", "finally", "then"]);

export const REACT_MODELED_HOOK_NAMES = new Set([
  "useCallback",
  "useContext",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useRef",
  "useReducer",
  "useState",
  "useSyncExternalStore",
]);

export const REACT_UNMODELED_HOOK_NAMES = new Set([
  "use",
  "useActionState",
  "useDeferredValue",
  "useImperativeHandle",
  "useOptimistic",
  "useTransition",
]);

export const KNOWN_IMPURE_RENDER_CALLS = new Set([
  "crypto.randomUUID",
  "Date.now",
  "Math.random",
  "performance.now",
]);

export const KNOWN_PURE_GLOBAL_CALLS = new Set([
  "Boolean",
  "Number",
  "Object.entries",
  "Object.is",
  "Object.keys",
  "Object.values",
  "String",
]);

export const KNOWN_PURE_METHOD_NAMES = new Set([
  "at",
  "concat",
  "endsWith",
  "entries",
  "every",
  "filter",
  "find",
  "findIndex",
  "flat",
  "flatMap",
  "includes",
  "indexOf",
  "join",
  "keys",
  "map",
  "reduce",
  "reduceRight",
  "slice",
  "some",
  "startsWith",
  "substring",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "values",
]);

export const KNOWN_PURE_STANDARD_METHOD_NAMES = new Set(["get", "has"]);
export const KNOWN_MUTATING_STANDARD_METHOD_NAMES = new Set(["add", "clear", "delete", "set"]);

export const SYNCHRONOUS_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

export const MUTATING_METHOD_NAMES = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

export const CLASS_STATE_MUTATING_METHOD_NAMES = new Set([
  ...MUTATING_METHOD_NAMES,
  "add",
  "clear",
  "delete",
  "set",
]);

export const REACT_RUNTIME_MODULE_NAMES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
]);

export const REACT_EVENT_PROP_PATTERN = /^on[A-Z]/;
