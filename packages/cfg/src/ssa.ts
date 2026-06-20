import type { EsTreeNode } from "./ast/es-tree-node.js";
import { eliminateRedundantPhis } from "./analysis/eliminate-redundant-phi.js";
import { enterSsa } from "./analysis/enter-ssa.js";
import { enumerateFunctions } from "./analysis/enumerate-functions.js";
import { createLexicalBindingResolver } from "./analysis/lexical-binding-resolver.js";
import { collectPlacesByBlock } from "./analysis/places-by-block.js";
import { analyzeControlFlow } from "./control-flow-graph.js";
import type { ControlFlowAnalysis } from "./control-flow-graph.js";
import type { BasicBlock, FunctionCfg } from "./ir/basic-block.js";
import type { BindingId, Phi, ResolveBinding, SsaIdentifier } from "./ir/place.js";

// SSA for a single function-like (or the program) CFG.
export interface FunctionSsa {
  readonly cfg: FunctionCfg;
  // φ-functions at a block's head (empty for non-join blocks).
  readonly phisOf: (block: BasicBlock) => ReadonlyArray<Phi>;
  // Reachable blocks that contain a write of `binding` — the input to the
  // dominance-frontier φ-placement oracle.
  readonly defBlocksOf: (binding: BindingId) => ReadonlySet<BasicBlock>;
  // Every binding written at least once in this function.
  readonly definedBindings: ReadonlySet<BindingId>;
}

// Variable-level SSA over a whole program, one `FunctionSsa` per function.
// Built on the oxc-native CFG via the Braun on-the-fly construction; query
// methods are identifier-node-keyed so rules never touch blocks directly.
export interface SsaAnalysis {
  readonly controlFlow: ControlFlowAnalysis;
  readonly ssaFor: (functionLike: EsTreeNode) => FunctionSsa | null;
  // The binding an identifier references (null for globals/unresolved).
  readonly bindingOf: (node: EsTreeNode) => BindingId | null;
  // The SSA value read or written at an identifier node (read wins for a
  // compound-assignment / update target, which is both).
  readonly versionAt: (node: EsTreeNode) => SsaIdentifier | null;
  // The SSA value flowing into a use — its reaching definition.
  readonly reachingDefinition: (useNode: EsTreeNode) => SsaIdentifier | null;
  // The SSA value is read somewhere — directly, or transitively as a φ
  // operand of a live value. A write whose value is NOT live is a dead
  // store (overwritten before any read).
  readonly isLiveValue: (identifier: SsaIdentifier) => boolean;
  // `binding` is written somewhere strictly on a control-flow path from
  // `fromNode` to `toNode` (its value at `toNode` may differ from
  // `fromNode`). Same enclosing function only.
  readonly isRedefinedBetween: (
    fromNode: EsTreeNode,
    toNode: EsTreeNode,
    binding: BindingId,
  ) => boolean;
}

export const analyzeSsa = (
  program: EsTreeNode,
  resolveBinding: ResolveBinding = createLexicalBindingResolver(program),
): SsaAnalysis => {
  const controlFlow = analyzeControlFlow(program);
  const functionSsa = new Map<EsTreeNode, FunctionSsa>();
  const readIdentifierAt = new Map<EsTreeNode, SsaIdentifier>();
  const writeIdentifierAt = new Map<EsTreeNode, SsaIdentifier>();
  const emptyDefBlocks: ReadonlySet<BasicBlock> = new Set();

  for (const owner of enumerateFunctions(program)) {
    const cfg = controlFlow.cfgFor(owner);
    if (!cfg) continue;
    const placesByBlock = collectPlacesByBlock(cfg, owner, resolveBinding);

    const construction = enterSsa(cfg, placesByBlock);
    eliminateRedundantPhis(cfg, construction);

    for (const [node, identifier] of construction.readIdentifierAt) {
      readIdentifierAt.set(node, identifier);
    }
    for (const [node, identifier] of construction.writeIdentifierAt) {
      writeIdentifierAt.set(node, identifier);
    }

    const defBlocks = construction.defBlocks;
    functionSsa.set(owner, {
      cfg,
      phisOf: (block) => block.phis,
      defBlocksOf: (binding) => defBlocks.get(binding) ?? emptyDefBlocks,
      definedBindings: new Set(defBlocks.keys()),
    });
  }

  // A value is live if a read resolves to it, or it feeds a φ whose result
  // is itself live. Seed from every read's reaching def, then propagate
  // backward through φ operands to a fixpoint.
  const liveValues = new Set<SsaIdentifier>(readIdentifierAt.values());
  const phisByIdentifier = new Map<SsaIdentifier, Phi>();
  for (const { cfg } of functionSsa.values()) {
    for (const block of cfg.blocks) {
      for (const phi of block.phis) phisByIdentifier.set(phi.identifier, phi);
    }
  }
  const liveWorklist = [...liveValues];
  while (liveWorklist.length > 0) {
    const value = liveWorklist.pop()!;
    const phi = phisByIdentifier.get(value);
    if (!phi) continue;
    for (const operand of phi.operands.values()) {
      if (!liveValues.has(operand)) {
        liveValues.add(operand);
        liveWorklist.push(operand);
      }
    }
  }

  const versionAt = (node: EsTreeNode): SsaIdentifier | null =>
    readIdentifierAt.get(node) ?? writeIdentifierAt.get(node) ?? null;

  const isRedefinedBetween = (
    fromNode: EsTreeNode,
    toNode: EsTreeNode,
    binding: BindingId,
  ): boolean => {
    for (const [node, identifier] of writeIdentifierAt) {
      if (identifier.binding !== binding) continue;
      if (node === fromNode || node === toNode) continue;
      if (controlFlow.isReachable(fromNode, node) && controlFlow.isReachable(node, toNode)) {
        return true;
      }
    }
    return false;
  };

  return {
    controlFlow,
    ssaFor: (functionLike) => functionSsa.get(functionLike) ?? null,
    bindingOf: (node) => resolveBinding(node),
    versionAt,
    reachingDefinition: (useNode) => readIdentifierAt.get(useNode) ?? null,
    isLiveValue: (identifier) => liveValues.has(identifier),
    isRedefinedBetween,
  };
};
