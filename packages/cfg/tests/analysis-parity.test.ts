import { describe, expect, it } from "vite-plus/test";
import { buildFunctionCfg } from "../src/build/build-function-cfg.js";
import { computeCyclicBlocks } from "../src/analysis/loops.js";
import { computeUnconditionalSet } from "../src/analysis/unconditional.js";
import type { BasicBlock, FunctionCfg } from "../src/ir/basic-block.js";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";
import { forEachChildNode } from "../src/ast/for-each-child-node.js";
import { isFunctionLike } from "../src/ast/is-function-like.js";
import { isNodeOfType } from "../src/ast/is-node-of-type.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";

// The exact O(V^3) brute force that `computeCyclicBlocks` replaced: for
// every block, BFS over non-throw successor edges and check whether the
// block can reach itself. The new SCC-based implementation must return an
// identical set for every CFG.
const computeCyclicBlocksBruteForce = (cfg: FunctionCfg): Set<BasicBlock> => {
  const cyclicBlocks = new Set<BasicBlock>();
  for (const startBlock of cfg.blocks) {
    const visited = new Set<BasicBlock>();
    const queue: BasicBlock[] = [];
    for (const edge of startBlock.successors) {
      if (edge.kind !== "throw") queue.push(edge.to);
    }
    let isOnCycle = false;
    while (queue.length > 0) {
      const block = queue.shift()!;
      if (block === startBlock) {
        isOnCycle = true;
        break;
      }
      if (visited.has(block)) continue;
      visited.add(block);
      for (const edge of block.successors) {
        if (edge.kind !== "throw") queue.push(edge.to);
      }
    }
    if (isOnCycle) cyclicBlocks.add(startBlock);
  }
  return cyclicBlocks;
};

// The exact remove-a-block-and-re-test-reachability brute force that the
// index-cursor `computeUnconditionalSet` is derived from. The cursor
// change only affects traversal order, so the produced set must be
// byte-identical to this over every CFG.
const computeUnconditionalSetBruteForce = (cfg: FunctionCfg): Set<BasicBlock> => {
  const reachableFromEntry = (excluded: BasicBlock | null): Set<BasicBlock> => {
    const visited = new Set<BasicBlock>();
    const queue: BasicBlock[] = [];
    if (cfg.entry !== excluded) queue.push(cfg.entry);
    while (queue.length > 0) {
      const block = queue.shift()!;
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

  const reachableFromEntryFull = reachableFromEntry(null);

  const unconditional = new Set<BasicBlock>();
  unconditional.add(cfg.entry);
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

// Every function-like node + the Program of a fixture, each lowered to its
// own CFG — exactly the set `analyzeControlFlow` builds internally.
const cfgsOf = (code: string): FunctionCfg[] => {
  const parsed = parseFixture(code);
  if (parsed.errors.length > 0) {
    throw new Error(
      `parity fixture failed to parse: ${parsed.errors.map((e) => e.message).join("; ")}`,
    );
  }
  attachParentReferences(parsed.program);
  const cfgs: FunctionCfg[] = [];
  if (isNodeOfType(parsed.program, "Program")) {
    cfgs.push(buildFunctionCfg(parsed.program, parsed.program));
  }
  const visit = (node: EsTreeNode): void => {
    if (isFunctionLike(node)) {
      const body = (node as { body: EsTreeNode }).body;
      if (body) cfgs.push(buildFunctionCfg(node, body));
    }
    forEachChildNode(node, visit);
  };
  visit(parsed.program);
  return cfgs;
};

const sortedBlockIds = (blocks: Set<BasicBlock>): number[] =>
  [...blocks].map((block) => block.id).sort((left, right) => left - right);

// Hand-built tricky CFGs alongside the broad fixture corpus — early
// throw, if/throw, nested + labeled loops, infinite loops, dead code
// after return, try/catch/finally, switch fall-through, and self-loops.
const PARITY_FIXTURES: ReadonlyArray<{ name: string; code: string }> = [
  { name: "straight line", code: "function f() { a(); b(); c(); }" },
  { name: "if / else join", code: "function f(x) { if (x) { a(); } else { b(); } c(); }" },
  { name: "if without else", code: "function f(x) { if (x) { a(); } b(); }" },
  { name: "early throw", code: "function f(x) { if (x) throw new Error(); a(); }" },
  {
    name: "if/throw both arms",
    code: "function f(x) { if (x) { throw 1; } else { throw 2; } a(); }",
  },
  {
    name: "early return then dead code",
    code: "function f(x) { if (x) return; a(); return; b(); }",
  },
  { name: "unconditional return then dead", code: "function f() { a(); return; b(); c(); }" },
  { name: "while loop", code: "function f(x) { while (x) { a(); } b(); }" },
  { name: "do-while loop", code: "function f(x) { do { a(); } while (x); b(); }" },
  { name: "for loop", code: "function f(n) { for (let i = 0; i < n; i++) { a(); } b(); }" },
  { name: "for-of loop", code: "function f(xs) { for (const x of xs) { a(x); } b(); }" },
  { name: "infinite while then dead", code: "function f() { while (true) { a(); } b(); }" },
  { name: "for(;;) infinite", code: "function f() { for (;;) { a(); } b(); }" },
  {
    name: "nested loops",
    code: "function f(n) { for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { a(); } } b(); }",
  },
  {
    name: "labeled loop with break/continue",
    code: "function f(n) { outer: for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { if (a()) continue outer; if (b()) break outer; } } c(); }",
  },
  {
    name: "loop with conditional break",
    code: "function f(x) { while (x) { if (a()) break; b(); } c(); }",
  },
  {
    name: "loop with continue",
    code: "function f(x) { while (x) { if (a()) continue; b(); } c(); }",
  },
  {
    name: "loop with throw inside",
    code: "function f(x) { while (x) { if (a()) throw 1; b(); } c(); }",
  },
  { name: "try/catch", code: "function f() { try { a(); } catch (e) { b(); } c(); }" },
  { name: "try/finally", code: "function f() { try { a(); } finally { b(); } c(); }" },
  {
    name: "try/catch/finally",
    code: "function f() { try { a(); } catch (e) { b(); } finally { c(); } d(); }",
  },
  {
    name: "try with return in finally",
    code: "function f() { try { return a(); } finally { b(); } c(); }",
  },
  {
    name: "try return then dead code",
    code: "function f() { try { return a(); } finally { return b(); } c(); }",
  },
  {
    name: "switch with fallthrough",
    code: "function f(x) { switch (x) { case 1: a(); case 2: b(); break; default: c(); } d(); }",
  },
  {
    name: "switch all break",
    code: "function f(x) { switch (x) { case 1: a(); break; case 2: b(); break; default: c(); } d(); }",
  },
  { name: "ternary in expression", code: "const g = (x) => (x ? a() : b());" },
  { name: "logical short circuit", code: "function f(x) { x && a() && b(); c(); }" },
  {
    name: "nested function",
    code: "function outer(x) { const inner = (y) => { while (y) a(); }; if (x) inner(x); b(); }",
  },
  {
    name: "loop after early return",
    code: "function f(x) { if (x) return; while (a()) { b(); } c(); }",
  },
  {
    name: "deeply nested branches and loops",
    code: "function f(a, b, c) { if (a) { for (;;) { if (b) break; while (c) { d(); } } } else { e(); } g(); }",
  },
];

describe("analysis parity", () => {
  describe("computeCyclicBlocks matches the brute-force definition", () => {
    for (const fixture of PARITY_FIXTURES) {
      it(fixture.name, () => {
        for (const cfg of cfgsOf(fixture.code)) {
          expect(sortedBlockIds(computeCyclicBlocks(cfg))).toEqual(
            sortedBlockIds(computeCyclicBlocksBruteForce(cfg)),
          );
        }
      });
    }
  });

  describe("computeUnconditionalSet matches the brute-force definition", () => {
    for (const fixture of PARITY_FIXTURES) {
      it(fixture.name, () => {
        for (const cfg of cfgsOf(fixture.code)) {
          expect(sortedBlockIds(computeUnconditionalSet(cfg))).toEqual(
            sortedBlockIds(computeUnconditionalSetBruteForce(cfg)),
          );
        }
      });
    }
  });
});
