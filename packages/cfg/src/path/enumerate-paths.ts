import { MAX_PATH_BLOCK_LENGTH, MAX_PATH_VISITS, MAX_VIOLATION_PATHS } from "../constants.js";
import type { BasicBlock, CfgEdge } from "../ir/basic-block.js";

export interface SimplePathQuery {
  readonly start: BasicBlock;
  readonly isGoal: (block: BasicBlock) => boolean;
  // Non-goal blocks the search may pass through. Pruning a block drops every
  // path through it from the result — how a caller carves "no write of the
  // binding" / "no release of the resource" counterexample paths. Goal blocks
  // are always reachable regardless of this predicate.
  readonly canTraverse?: (block: BasicBlock) => boolean;
  // Edge kinds the search may follow; defaults to every kind except `throw`
  // (a leak / use-before-define on an exceptional path is a separate concern).
  readonly canFollow?: (edge: CfgEdge) => boolean;
  readonly maxPaths?: number;
  readonly maxLength?: number;
  // Global budget on total node expansions across the search, bounding the
  // blow-up when goal blocks are sparse (so the `maxPaths` cap never trips)
  // and the only other limit is per-path `maxLength`.
  readonly maxVisits?: number;
}

export interface SimplePathResult {
  readonly paths: ReadonlyArray<ReadonlyArray<BasicBlock>>;
  // `false` once a cap cut the search short: the set is partial, so a caller
  // must NOT read "every path here is infeasible" as "every path is".
  readonly complete: boolean;
}

// Enumerate the simple (acyclic) paths from `start` to a goal block. The
// acyclicity constraint bounds loops to a single unrolling and guarantees
// termination; the caps bound the blow-up on diamond-heavy CFGs. Used only to
// refine diagnostics, never in a hot loop.
export const enumerateSimplePaths = (query: SimplePathQuery): SimplePathResult => {
  const canFollow = query.canFollow ?? ((edge) => edge.kind !== "throw");
  const canTraverse = query.canTraverse ?? (() => true);
  const maxPaths = query.maxPaths ?? MAX_VIOLATION_PATHS;
  const maxLength = query.maxLength ?? MAX_PATH_BLOCK_LENGTH;
  const maxVisits = query.maxVisits ?? MAX_PATH_VISITS;

  const paths: BasicBlock[][] = [];
  const onStack = new Set<BasicBlock>();
  let complete = true;
  let visits = 0;

  const visit = (block: BasicBlock, trail: BasicBlock[]): void => {
    if (!complete) return;
    if (++visits > maxVisits) {
      complete = false;
      return;
    }
    if (query.isGoal(block)) {
      paths.push([...trail, block]);
      if (paths.length > maxPaths) complete = false;
      return;
    }
    if (trail.length + 1 > maxLength) {
      complete = false;
      return;
    }
    onStack.add(block);
    trail.push(block);
    for (const edge of block.successors) {
      if (!complete) break;
      if (!canFollow(edge)) continue;
      const next = edge.to;
      if (onStack.has(next)) continue;
      if (!query.isGoal(next) && !canTraverse(next)) continue;
      visit(next, trail);
    }
    trail.pop();
    onStack.delete(block);
  };

  visit(query.start, []);
  return { paths, complete };
};
