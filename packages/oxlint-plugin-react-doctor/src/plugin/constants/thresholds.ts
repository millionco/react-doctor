export const GIANT_COMPONENT_LINE_THRESHOLD = 300;
export const CASCADING_SET_STATE_THRESHOLD = 3;
export const RELATED_USE_STATE_THRESHOLD = 5;
export const DEEP_NESTING_THRESHOLD = 3;
export const DUPLICATE_STORAGE_READ_THRESHOLD = 2;
export const SEQUENTIAL_AWAIT_THRESHOLD = 3;
export const PROPERTY_ACCESS_REPEAT_THRESHOLD = 3;
export const BOOLEAN_PROP_THRESHOLD = 4;
export const RENDER_PROP_PROLIFERATION_THRESHOLD = 3;
export const GET_HANDLER_BINDING_RESOLUTION_DEPTH = 3;
// Chains rooted in a literal array `[a, b, c].map(...).filter(...)` at
// or below this length are skipped by the iteration-combination rules
// (js-combine-iterations, js-flatmap-filter) — iterating 8-element-
// or-fewer literals twice is trivial cost, the rewrite is pure
// ceremony at this scale.
export const SMALL_LITERAL_ARRAY_MAX_ELEMENTS = 8;
