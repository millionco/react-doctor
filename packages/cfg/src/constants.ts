// Hard caps for the bounded path-feasibility checker (Layer D). Exceeding
// any cap makes the checker return `unknown` rather than spend unbounded
// time — and `unknown` never suppresses a diagnostic, so the caps only ever
// cost precision, never soundness.

// Max number of lowered facts (branch guards) in one path condition.
export const MAX_PATH_CLAUSES = 64;

// Max number of distinct abstract atoms (SSA values + constants) tracked.
export const MAX_PATH_VARS = 48;

// Max number of counterexample paths enumerated when refining a diagnostic.
export const MAX_VIOLATION_PATHS = 32;

// Max block length of any single enumerated counterexample path.
export const MAX_PATH_BLOCK_LENGTH = 128;
