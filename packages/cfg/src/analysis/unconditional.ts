import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";

// A block B is "unconditional from entry" iff every execution path
// from entry to exit passes through B. We compute this by, for each
// block B, asking: if we removed B from the graph, is exit still
// reachable from entry? If NO, B is on every path → unconditional.
//
// Cost: O(|blocks|^2) — fine for function-sized CFGs (typically <100
// blocks). Avoids needing a full dominator tree.
export const computeUnconditionalSet = (cfg: FunctionCfg): Set<BasicBlock> => {
  // Skip "throw" edges when computing reachability — uncaught throws
  // don't represent a normal completion path. This makes
  // `if (x) throw; useHook();` evaluate as unconditional (the
  // `useHook` block is the only normal path to exit).
  const reachableFromEntry = (excluded: BasicBlock | null): Set<BasicBlock> => {
    const visited = new Set<BasicBlock>();
    const queue: BasicBlock[] = [];
    if (cfg.entry !== excluded) queue.push(cfg.entry);
    // Index cursor instead of `queue.shift()` — the shift is O(V), which
    // would make each traversal O(V^2); a head index keeps it O(V+E).
    let head = 0;
    while (head < queue.length) {
      const block = queue[head++]!;
      if (visited.has(block)) continue;
      visited.add(block);
      for (const edge of block.successors) {
        if (edge.kind === "throw") continue;
        if (edge.to === excluded) continue;
        queue.push(edge.to);
      }
    }
    return visited;
  };

  // Whole-graph reachability: any block NOT in this set is dead code
  // (e.g. statements after an unconditional `return;` / `throw;`).
  // Dead-code blocks vacuously satisfy "unconditional from entry"
  // because the call site is never reached at runtime — there's
  // nothing to constrain.
  const reachableFromEntryFull = reachableFromEntry(null);

  const unconditional = new Set<BasicBlock>();
  // Entry is trivially on every path.
  unconditional.add(cfg.entry);
  // Exit is on every (terminating) path.
  unconditional.add(cfg.exit);
  for (const block of cfg.blocks) {
    if (unconditional.has(block)) continue;
    if (!reachableFromEntryFull.has(block)) {
      unconditional.add(block);
      continue;
    }
    const stillReaches = reachableFromEntry(block).has(cfg.exit);
    if (!stillReaches) unconditional.add(block);
  }
  return unconditional;
};
