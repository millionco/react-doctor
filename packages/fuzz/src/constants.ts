export const DEFAULT_FUZZ_ITERATIONS = 25;
export const DEFAULT_FUZZ_SEED = 1;
export const SLOW_RULE_THRESHOLD_MS = 2_000;
export const NOISE_MUTATION_PROBABILITY = 0.4;
export const MAX_NOISE_MUTATIONS = 3;
// One iteration in ~8 produces a pathological-shape program (deep JSX,
// long chains) instead of a realistic one, probing recursive walkers.
export const PATHOLOGICAL_PROGRAM_PROBABILITY = 0.12;
export const DEEP_JSX_NESTING_DEPTH = 250;
export const LONG_CHAIN_LINK_COUNT = 300;
export const WIDE_SIBLING_COUNT = 400;
export const NESTED_TERNARY_DEPTH = 120;
export const WIDE_COMPONENT_STATEMENT_COUNT = 250;
// When a program makes the rule fire, mutate it this many extra times and
// re-run — a cheap feedback loop that keeps fuzzing near reporting paths.
export const EXPLOIT_DESCENDANT_COUNT = 3;
export const MAX_CORPUS_FILES = 400;
export const MAX_CORPUS_FILE_BYTES = 48_000;
// Fraction of iterations that start from a corpus file (when FUZZ_CORPUS_DIR
// is set) instead of a generated program.
export const CORPUS_PROGRAM_PROBABILITY = 0.5;
