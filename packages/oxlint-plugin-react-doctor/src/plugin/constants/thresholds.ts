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

// Cross-file resolution bounds for the reducer / cross-file rules.
// `CROSS_FILE_PARSE_MAX_BYTES` skips parsing generated / vendored files
// large enough to slow a lint run; `CROSS_FILE_BARREL_FOLLOW_DEPTH`
// caps how many re-export hops the barrel resolver chases before
// giving up.
export const CROSS_FILE_PARSE_MAX_BYTES = 2_000_000;
export const CROSS_FILE_BARREL_FOLLOW_DEPTH = 4;

// Bounds for upward directory walks used by cross-file resolvers:
// `CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS` caps how many parent
// directories we climb looking for a `tsconfig.json` (alias resolution)
// or an ancestor `layout.tsx` (App Router Suspense boundary), so a file
// deep outside any project can't trigger an unbounded climb to the
// filesystem root. `TSCONFIG_EXTENDS_MAX_DEPTH` caps `extends` chains.
export const CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS = 30;
export const TSCONFIG_EXTENDS_MAX_DEPTH = 8;

// Upper bound on the number of distinct control-flow path states the
// reducer mutation analyzer tracks before bailing out. A reducer with N
// sequential non-returning `if`s forks 2^N path states; without this
// cap a deeply-branched reducer would blow up time + memory. Bailing is
// safe — it can only cause missed diagnostics, never false positives.
export const REDUCER_PATH_STATE_LIMIT = 1000;
