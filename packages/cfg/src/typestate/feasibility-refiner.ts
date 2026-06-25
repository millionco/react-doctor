import type { EsTreeNode } from "../ast/es-tree-node.js";
import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";
import { enumerateSimplePaths } from "../path/enumerate-paths.js";
import type { SimplePathResult } from "../path/enumerate-paths.js";
import type { ResolveValueAtom } from "../path/path-condition.js";
import { everyCounterexampleInfeasible } from "../path/prune-infeasible.js";
import type { TypestateAutomaton } from "./automaton.js";
import type { EventsByBlock, ResourceEvent } from "./verify.js";

// Layer D refinement for the typestate engine: decide whether a candidate
// violation is a proven false positive because every path that would witness
// it is infeasible. Both queries only ever return `true` on a complete search
// where the whole counterexample set is provably infeasible, so they can only
// remove false positives — never hide a real bug.
export interface TypestateFeasibilityRefiner {
  // The error transition at `event` is unreachable on every feasible path.
  readonly errorProvablyInfeasible: (event: ResourceEvent) => boolean;
  // The leak of `resource` (first mentioned at `openNode`) can't happen on any
  // feasible normal-completion path.
  readonly leakProvablyInfeasible: (resource: string, openNode: EsTreeNode | undefined) => boolean;
}

export interface FeasibilityRefinerContext {
  readonly cfg: FunctionCfg;
  readonly automaton: TypestateAutomaton;
  readonly eventsByBlock: EventsByBlock;
  readonly initialState: string;
  // The Layer D seam. Absent → the refiner is a no-op and nothing is ever
  // suppressed (the engine stays purely path-insensitive).
  readonly resolveValue: ResolveValueAtom | undefined;
}

const NEVER_SUPPRESS: TypestateFeasibilityRefiner = {
  errorProvablyInfeasible: () => false,
  leakProvablyInfeasible: () => false,
};

export const createTypestateFeasibilityRefiner = (
  context: FeasibilityRefinerContext,
): TypestateFeasibilityRefiner => {
  const { cfg, automaton, eventsByBlock, initialState, resolveValue } = context;
  if (!resolveValue) return NEVER_SUPPRESS;

  // Memoize entry→block simple-path sets: the leak check always targets the
  // exit, and many error events share a block, so each block's path set is
  // enumerated at most once per verification rather than per diagnostic.
  const pathsToBlockCache = new Map<BasicBlock, SimplePathResult>();
  const pathsToBlock = (block: BasicBlock): SimplePathResult => {
    let cached = pathsToBlockCache.get(block);
    if (!cached) {
      cached = enumerateSimplePaths({
        start: cfg.entry,
        isGoal: (candidate) => candidate === block,
      });
      pathsToBlockCache.set(block, cached);
    }
    return cached;
  };

  // Replay `resource`'s possible states along one concrete block path — the
  // path-sensitive analogue of the joined fixpoint. With `stopBeforeNode`, it
  // returns the states immediately BEFORE that event executes (what the
  // offending transition is applied to); otherwise it replays the whole path.
  const replayResourceStates = (
    resource: string,
    path: ReadonlyArray<BasicBlock>,
    stopBeforeNode?: EsTreeNode,
  ): Set<string> => {
    let states = new Set<string>([initialState]);
    for (const block of path) {
      for (const resourceEvent of eventsByBlock.get(block) ?? []) {
        if (resourceEvent.resource !== resource) continue;
        if (stopBeforeNode && resourceEvent.node === stopBeforeNode) return states;
        const next = new Set<string>();
        for (const state of states) {
          next.add(automaton.transition(state, resourceEvent.event));
        }
        states = next;
      }
    }
    return states;
  };

  const errorProvablyInfeasible = (event: ResourceEvent): boolean => {
    const block = cfg.blockOf(event.node);
    if (!block) return false;
    return everyCounterexampleInfeasible(pathsToBlock(block), resolveValue, (path) =>
      [...replayResourceStates(event.resource, path, event.node)].some(
        (state) =>
          !automaton.errorStates.has(state) &&
          automaton.errorStates.has(automaton.transition(state, event.event)),
      ),
    );
  };

  const leakProvablyInfeasible = (resource: string, openNode: EsTreeNode | undefined): boolean => {
    const openBlock = openNode ? cfg.blockOf(openNode) : null;
    if (!openBlock) return false;
    return everyCounterexampleInfeasible(pathsToBlock(cfg.exit), resolveValue, (path) => {
      if (!path.includes(openBlock)) return false;
      return [...replayResourceStates(resource, path)].some(
        (state) => !automaton.acceptingStates.has(state) && !automaton.errorStates.has(state),
      );
    });
  };

  return { errorProvablyInfeasible, leakProvablyInfeasible };
};
