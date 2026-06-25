import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";

// A block is on a cycle iff it can reach itself by following non-throw
// successor edges (loop back-edges are normal "uncond" edges; a
// throw→catch edge is not a loop). That set is exactly: every block in a
// non-trivial strongly-connected component (≥2 blocks) of the
// non-throw-edge subgraph, PLUS any block carrying a non-throw self-loop
// edge (a one-block cycle, which an SCC of size 1 doesn't capture).
//
// We find the SCCs with a single iterative Tarjan pass over the
// non-throw-edge subgraph — one O(V+E) walk instead of a per-block BFS.
export const computeCyclicBlocks = (cfg: FunctionCfg): Set<BasicBlock> => {
  const cyclicBlocks = new Set<BasicBlock>();

  // Tarjan's SCC, iterated to keep deep CFGs off the call stack. `index`
  // and `lowlink` are the standard DFS-discovery / earliest-reachable
  // numbers; `onStack` tracks blocks in the current SCC candidate.
  const indexOf = new Map<BasicBlock, number>();
  const lowlinkOf = new Map<BasicBlock, number>();
  const onStack = new Set<BasicBlock>();
  const sccStack: BasicBlock[] = [];
  let nextIndex = 0;

  interface Frame {
    block: BasicBlock;
    nextSuccessor: number;
  }

  const nonThrowSuccessors = (block: BasicBlock): BasicBlock[] =>
    block.successors.filter((edge) => edge.kind !== "throw").map((edge) => edge.to);

  const strongConnect = (root: BasicBlock): void => {
    const frames: Frame[] = [{ block: root, nextSuccessor: 0 }];
    indexOf.set(root, nextIndex);
    lowlinkOf.set(root, nextIndex);
    nextIndex += 1;
    sccStack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const successors = nonThrowSuccessors(frame.block);
      if (frame.nextSuccessor < successors.length) {
        const successor = successors[frame.nextSuccessor]!;
        frame.nextSuccessor += 1;
        if (!indexOf.has(successor)) {
          indexOf.set(successor, nextIndex);
          lowlinkOf.set(successor, nextIndex);
          nextIndex += 1;
          sccStack.push(successor);
          onStack.add(successor);
          frames.push({ block: successor, nextSuccessor: 0 });
        } else if (onStack.has(successor)) {
          lowlinkOf.set(
            frame.block,
            Math.min(lowlinkOf.get(frame.block)!, indexOf.get(successor)!),
          );
        }
        continue;
      }

      // All successors of frame.block explored: close out its SCC if it is
      // a root, then propagate its lowlink up to the parent frame.
      if (lowlinkOf.get(frame.block)! === indexOf.get(frame.block)!) {
        const component: BasicBlock[] = [];
        let popped: BasicBlock;
        do {
          popped = sccStack.pop()!;
          onStack.delete(popped);
          component.push(popped);
        } while (popped !== frame.block);
        if (component.length >= 2) {
          for (const block of component) cyclicBlocks.add(block);
        }
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) {
        lowlinkOf.set(
          parent.block,
          Math.min(lowlinkOf.get(parent.block)!, lowlinkOf.get(frame.block)!),
        );
      }
    }
  };

  for (const block of cfg.blocks) {
    if (!indexOf.has(block)) strongConnect(block);
  }

  // A block in a singleton SCC is still cyclic if it has a non-throw edge
  // straight back to itself (a self-loop the SCC-size test misses).
  for (const block of cfg.blocks) {
    if (cyclicBlocks.has(block)) continue;
    for (const edge of block.successors) {
      if (edge.kind !== "throw" && edge.to === block) {
        cyclicBlocks.add(block);
        break;
      }
    }
  }

  return cyclicBlocks;
};
