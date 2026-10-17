export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const THREE_REF_SINGLE_ARGUMENT_COUNT = 1;
export const THREE_REF_EFFECT_ARGUMENT_COUNT = 2;
export const THREE_REF_FIRST_ARGUMENT_INDEX = 0;
export const THREE_REF_DEPENDENCY_ARGUMENT_INDEX = 1;
export const THREE_REF_EMPTY_COUNT = 0;
export const THREE_REF_EXPOSED_GLOBAL_NAMES = new Set([
  "Object",
  "Reflect",
  "Array",
  "global",
  "globalThis",
  "window",
  "self",
  "eval",
  "Function",
  "require",
  "module",
]);
export const THREE_REF_EXPOSED_PROPERTY_NAMES = new Set(["prototype", "constructor", "__proto__"]);
export const THREE_REF_LOADER_MODULES = new Set(["module", "node:module"]);
export const THREE_REF_REACT_APIS = new Set(["useRef", "useEffect"]);
export const THREE_REF_FIBER_APIS = new Set(["useThree", "useFrame"]);
export const THREE_REF_VECTOR_PROPERTIES = new Set(["position", "scale"]);
export const THREE_REF_CHILD_CONSTRUCTORS = new Set(["Group", "ArrowHelper"]);
