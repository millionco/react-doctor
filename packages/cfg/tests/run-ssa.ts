import { expect } from "vite-plus/test";
import { analyzeSsa } from "../src/ssa.js";
import type { FunctionSsa, SsaAnalysis } from "../src/ssa.js";
import { computeDominatorTree } from "../src/analysis/dominators.js";
import { isAstNode } from "../src/ast/is-ast-node.js";
import { isFunctionLike } from "../src/ast/is-function-like.js";
import { isNodeOfType } from "../src/ast/is-node-of-type.js";
import type { BasicBlock } from "../src/ir/basic-block.js";
import type { BindingId } from "../src/ir/place.js";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";

export interface SsaFixture {
  readonly ssa: SsaAnalysis;
  readonly program: EsTreeNode;
  // Every function-like node (plus the Program) that has an SSA result.
  readonly functions: ReadonlyArray<{ owner: EsTreeNode; functionSsa: FunctionSsa }>;
  // Resolves an identifier marker to its node. `"x"` is the first `x`
  // identifier in source order; `"x#2"` the second.
  readonly identifier: (spec: string) => EsTreeNode;
}

const collectIdentifiers = (root: EsTreeNode, name: string): EsTreeNode[] => {
  const matches: EsTreeNode[] = [];
  const visit = (node: EsTreeNode): void => {
    if (isNodeOfType(node, "Identifier") && node.name === name) matches.push(node);
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(root);
  return matches;
};

export const analyzeSsaFixture = (code: string): SsaFixture => {
  const parsed = parseFixture(code);
  if (parsed.errors.length > 0) {
    throw new Error(
      `SSA fixture failed to parse: ${parsed.errors.map((error) => error.message).join("; ")}`,
    );
  }
  attachParentReferences(parsed.program);
  const ssa = analyzeSsa(parsed.program);

  const functions: Array<{ owner: EsTreeNode; functionSsa: FunctionSsa }> = [];
  const pushFunction = (owner: EsTreeNode): void => {
    const functionSsa = ssa.ssaFor(owner);
    if (functionSsa) functions.push({ owner, functionSsa });
  };
  // The program, then every nested function-like node.
  pushFunction(parsed.program);
  const walk = (node: EsTreeNode): void => {
    if (isFunctionLike(node)) pushFunction(node);
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const candidate of child) if (isAstNode(candidate)) walk(candidate);
      } else if (isAstNode(child)) {
        walk(child);
      }
    }
  };
  walk(parsed.program);

  const identifier = (spec: string): EsTreeNode => {
    const hashIndex = spec.lastIndexOf("#");
    const name = hashIndex === -1 ? spec : spec.slice(0, hashIndex);
    const occurrence = hashIndex === -1 ? 1 : Number(spec.slice(hashIndex + 1));
    const matches = collectIdentifiers(parsed.program, name);
    const node = matches[occurrence - 1];
    if (!node) {
      throw new Error(
        `SSA identifier "${spec}" not found — fixture has ${matches.length} "${name}" identifier(s)`,
      );
    }
    return node;
  };

  return { ssa, program: parsed.program, functions, identifier };
};

// The classical iterated dominance frontier of a set of definition blocks
// (Cytron et al.). For a binding live across every relevant join, this is
// exactly where minimal SSA must place φ-functions — the strong oracle the
// Braun construction is checked against.
const iteratedDominanceFrontier = (
  definitionBlocks: ReadonlySet<BasicBlock>,
  dominanceFrontierOf: (block: BasicBlock) => ReadonlySet<BasicBlock>,
): Set<BasicBlock> => {
  const result = new Set<BasicBlock>();
  const worklist = [...definitionBlocks];
  while (worklist.length > 0) {
    const block = worklist.pop()!;
    for (const frontierBlock of dominanceFrontierOf(block)) {
      if (!result.has(frontierBlock)) {
        result.add(frontierBlock);
        worklist.push(frontierBlock);
      }
    }
  }
  return result;
};

interface PhiPlacement {
  // Blocks carrying a φ for the binding, by block id (sorted).
  readonly phiBlockIds: number[];
  // The iterated dominance frontier of the binding's def blocks, by id.
  readonly frontierBlockIds: number[];
}

const placementFor = (functionSsa: FunctionSsa, binding: BindingId): PhiPlacement => {
  const dominatorTree = computeDominatorTree(functionSsa.cfg.entry);
  const phiBlockIds: number[] = [];
  for (const block of functionSsa.cfg.blocks) {
    if (functionSsa.phisOf(block).some((phi) => phi.identifier.binding === binding)) {
      phiBlockIds.push(block.id);
    }
  }
  const frontier = iteratedDominanceFrontier(functionSsa.defBlocksOf(binding), (block) =>
    dominatorTree.dominanceFrontierOf(block),
  );
  return {
    phiBlockIds: phiBlockIds.sort((a, b) => a - b),
    frontierBlockIds: [...frontier].map((block) => block.id).sort((a, b) => a - b),
  };
};

// Soundness invariant, asserted on EVERY fixture: a φ can only sit at a
// block in the iterated dominance frontier of its binding's definitions.
// Braun must never place a φ outside it.
export const assertPhisWithinDominanceFrontier = (fixture: SsaFixture): void => {
  for (const { functionSsa } of fixture.functions) {
    for (const binding of functionSsa.definedBindings) {
      const { phiBlockIds, frontierBlockIds } = placementFor(functionSsa, binding);
      const frontierSet = new Set(frontierBlockIds);
      const stray = phiBlockIds.filter((id) => !frontierSet.has(id));
      expect(`binding ${binding} φ outside frontier: [${stray}]`).toBe(
        `binding ${binding} φ outside frontier: []`,
      );
    }
  }
};

// Completeness, asserted on fixtures where the tested binding is live at
// every join: the φ placement equals the iterated dominance frontier
// exactly (the classic minimal-SSA equivalence).
export const assertPhiPlacementEqualsFrontier = (
  fixture: SsaFixture,
  bindingNode: EsTreeNode,
): void => {
  const binding = fixture.ssa.bindingOf(bindingNode);
  expect(binding).not.toBeNull();
  for (const { functionSsa } of fixture.functions) {
    if (!functionSsa.definedBindings.has(binding!)) continue;
    const { phiBlockIds, frontierBlockIds } = placementFor(functionSsa, binding!);
    expect(`φ blocks [${phiBlockIds}]`).toBe(`φ blocks [${frontierBlockIds}]`);
    return;
  }
  throw new Error("binding has no defining function in this fixture");
};
