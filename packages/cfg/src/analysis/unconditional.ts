import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";
import { computeDominatorTree } from "./dominators.js";

// A block B is "unconditional from entry" iff every execution of the function
// passes through B. For a function that completes normally that means B lies on
// every entry→exit path; for one that only ever loops forever it means B runs
// on every iteration of the loop it gets stuck in.
//
// We compute it with a cut test: B is unconditional iff, with B removed,
// execution can no longer reach a "completion" — the exit on a normal path, or
// the latch of an exit-less infinite loop, which we treat as a virtual edge to
// the exit so the test stays well-defined when the real exit is unreachable.
// Without those latch completions an exit-less `for (;;) { if (g) setX() }`
// would leave the exit unreachable and mark EVERY block unconditional, hiding
// the conditional `setX()` from a render-loop / hooks check. When the exit IS
// reachable there are no infinite latches, so this matches the plain
// "removing B disconnects exit from entry" test exactly.
//
// `throw` edges are skipped throughout: an uncaught throw is not a normal
// completion path, so `if (x) throw; useHook();` keeps `useHook` unconditional.
export const computeUnconditionalSet = (cfg: FunctionCfg): Set<BasicBlock> => {
  // Blocks that can reach the exit over non-throw edges (backward walk).
  const reachesExit = new Set<BasicBlock>([cfg.exit]);
  const reachesExitQueue: BasicBlock[] = [cfg.exit];
  let reachesExitHead = 0;
  while (reachesExitHead < reachesExitQueue.length) {
    const block = reachesExitQueue[reachesExitHead++]!;
    for (const edge of block.predecessors) {
      if (edge.kind === "throw") continue;
      if (!reachesExit.has(edge.from)) {
        reachesExit.add(edge.from);
        reachesExitQueue.push(edge.from);
      }
    }
  }

  // Latches of exit-less loops: the source of a non-throw back-edge (its target
  // dominates it) that cannot itself reach the exit. Each is a virtual
  // completion below. A normal loop's latch reaches the exit, so it adds
  // nothing and the reachable-exit case is unchanged.
  const dominatorTree = computeDominatorTree(cfg.entry);
  const infiniteLatches = new Set<BasicBlock>();
  for (const block of cfg.blocks) {
    if (reachesExit.has(block)) continue;
    for (const edge of block.successors) {
      if (edge.kind === "throw") continue;
      if (dominatorTree.dominates(edge.to, block)) {
        infiniteLatches.add(block);
        break;
      }
    }
  }

  // Can entry still reach a completion (the exit, or an infinite-loop latch)
  // once `excluded` is removed?
  const reachesCompletion = (excluded: BasicBlock | null): boolean => {
    const visited = new Set<BasicBlock>();
    const queue: BasicBlock[] = [];
    if (cfg.entry !== excluded) queue.push(cfg.entry);
    let head = 0;
    while (head < queue.length) {
      const block = queue[head++]!;
      if (visited.has(block)) continue;
      visited.add(block);
      if (block === cfg.exit || infiniteLatches.has(block)) return true;
      for (const edge of block.successors) {
        if (edge.kind === "throw") continue;
        if (edge.to === excluded) continue;
        queue.push(edge.to);
      }
    }
    return false;
  };

  // Whole-graph reachability (no exclusion): a block not reachable from entry
  // over normal edges is dead code (after an unconditional `return` / `throw`)
  // and vacuously unconditional — its call site never runs at all.
  const reachableFromEntry = new Set<BasicBlock>();
  const reachableQueue: BasicBlock[] = [cfg.entry];
  let reachableHead = 0;
  while (reachableHead < reachableQueue.length) {
    const block = reachableQueue[reachableHead++]!;
    if (reachableFromEntry.has(block)) continue;
    reachableFromEntry.add(block);
    for (const edge of block.successors) {
      if (edge.kind === "throw") continue;
      reachableQueue.push(edge.to);
    }
  }

  const unconditional = new Set<BasicBlock>();
  unconditional.add(cfg.entry);
  unconditional.add(cfg.exit);
  for (const block of cfg.blocks) {
    if (unconditional.has(block)) continue;
    if (!reachableFromEntry.has(block)) {
      unconditional.add(block);
      continue;
    }
    if (!reachesCompletion(block)) unconditional.add(block);
  }
  return unconditional;
};
