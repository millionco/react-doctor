import { describe, expect, it } from "vite-plus/test";
import { enumerateSimplePaths } from "../src/path/enumerate-paths.js";
import { MAX_PATH_VISITS } from "../src/constants.js";
import type { BasicBlock, CfgEdge, CfgEdgeKind } from "../src/ir/basic-block.js";

// Layer D — the global visit budget that keeps the simple-path enumeration
// bounded when goal blocks are sparse or unreachable, so the per-path caps'
// blind spot can't blow up on a diamond-heavy CFG.

const makeBlock = (id: number): BasicBlock => ({
  id,
  instructions: [],
  terminal: { kind: "unreachable" },
  successors: [],
  predecessors: [],
  phis: [],
});

const connect = (from: BasicBlock, to: BasicBlock, kind: CfgEdgeKind): void => {
  const edge: CfgEdge = { from, to, kind };
  from.successors.push(edge);
  to.predecessors.push(edge);
};

// A chain of `diamondCount` diamonds: each merge block branches via two `cond`
// edges to a left/right block that both reconverge at the next merge. The
// graph is a DAG, so the number of distinct simple paths from start to the
// final merge is 2^diamondCount — exponential, with no cycle to cap it.
const buildDiamondChain = (diamondCount: number): BasicBlock => {
  const start = makeBlock(0);
  let merge = start;
  let nextId = 1;
  for (let diamond = 0; diamond < diamondCount; diamond++) {
    const left = makeBlock(nextId++);
    const right = makeBlock(nextId++);
    const nextMerge = makeBlock(nextId++);
    connect(merge, left, "cond");
    connect(merge, right, "cond");
    connect(left, nextMerge, "uncond");
    connect(right, nextMerge, "uncond");
    merge = nextMerge;
  }
  return start;
};

describe("enumerateSimplePaths / global visit budget", () => {
  it("bounds the search on a goal-sparse diamond chain instead of hanging", () => {
    // 2^30 simple paths if fully explored; no block is ever a goal, so the
    // `maxPaths` cap can never trip. Only the visit budget keeps this bounded.
    const start = buildDiamondChain(30);

    const startedAt = Date.now();
    const result = enumerateSimplePaths({ start, isGoal: () => false });
    const elapsedMs = Date.now() - startedAt;

    expect(result.complete).toBe(false);
    expect(result.paths).toHaveLength(0);
    // The budget caps visits, so the DFS returns near-instantly rather than
    // grinding through ~2^30 paths.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("honors an explicit lower maxVisits", () => {
    const start = buildDiamondChain(30);
    const result = enumerateSimplePaths({ start, isGoal: () => false, maxVisits: 100 });
    expect(result.complete).toBe(false);
    expect(result.paths).toHaveLength(0);
  });

  it("stays complete for a small graph well under the budget", () => {
    const start = buildDiamondChain(2);
    // The single sink (the final merge) is the goal: 2^2 = 4 simple paths, far
    // under MAX_PATH_VISITS, so the search runs to completion.
    const isGoal = (block: BasicBlock): boolean => block.successors.length === 0;
    const result = enumerateSimplePaths({ start, isGoal });
    expect(result.complete).toBe(true);
    expect(result.paths).toHaveLength(4);
    expect(MAX_PATH_VISITS).toBeGreaterThan(result.paths.length);
  });
});
