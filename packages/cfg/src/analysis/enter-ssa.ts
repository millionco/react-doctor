import type { EsTreeNode } from "../ast/es-tree-node.js";
import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";
import type { BindingId, Phi, Place, SsaIdentifier } from "../ir/place.js";
import { successorBlocks } from "./block-edges.js";
import { reversePostorder } from "./reverse-postorder.js";

export interface SsaConstruction {
  // The SSA value flowing INTO each read occurrence (its reaching def).
  readonly readIdentifierAt: Map<EsTreeNode, SsaIdentifier>;
  // The SSA value DEFINED at each write occurrence.
  readonly writeIdentifierAt: Map<EsTreeNode, SsaIdentifier>;
  // Reachable blocks that write each binding — the φ-placement oracle input.
  readonly defBlocks: Map<BindingId, Set<BasicBlock>>;
}

// On-the-fly SSA construction via Braun, Buchwald, Hack et al. (2013),
// "Simple and Efficient Construction of Static Single Assignment Form"
// (the algorithm the React Compiler's `EnterSSA` also implements). It needs
// only `BasicBlock.predecessors`, the per-block read/write occurrences, and
// a version counter — no dominator tree. Loop headers are read before their
// back-edge predecessor is filled, so they receive *incomplete* φs that are
// completed when the header is sealed (all predecessors filled).
export const enterSsa = (
  cfg: FunctionCfg,
  placesByBlock: ReadonlyMap<BasicBlock, ReadonlyArray<Place>>,
): SsaConstruction => {
  const readIdentifierAt = new Map<EsTreeNode, SsaIdentifier>();
  const writeIdentifierAt = new Map<EsTreeNode, SsaIdentifier>();
  const defBlocks = new Map<BindingId, Set<BasicBlock>>();

  // currentDef[binding][block] — the SSA value of `binding` at the end of
  // `block` (or the in-progress phi result, to break read cycles).
  const currentDef = new Map<BindingId, Map<BasicBlock, SsaIdentifier>>();
  const sealed = new Set<BasicBlock>();
  const filled = new Set<BasicBlock>();
  const incompletePhis = new Map<BasicBlock, Map<BindingId, Phi>>();
  const versionCounter = new Map<BindingId, number>();

  const newVersion = (binding: BindingId, name: string): SsaIdentifier => {
    const version = versionCounter.get(binding) ?? 0;
    versionCounter.set(binding, version + 1);
    return { binding, version, name };
  };

  const writeVariable = (binding: BindingId, block: BasicBlock, value: SsaIdentifier): void => {
    let perBlock = currentDef.get(binding);
    if (!perBlock) {
      perBlock = new Map();
      currentDef.set(binding, perBlock);
    }
    perBlock.set(block, value);
  };

  const recordPhi = (block: BasicBlock, phi: Phi): void => {
    block.phis.push(phi);
  };

  const addPhiOperands = (binding: BindingId, block: BasicBlock, phi: Phi, name: string): void => {
    for (const edge of block.predecessors) {
      phi.operands.set(edge.from, readVariable(binding, edge.from, name));
    }
  };

  const readVariableRecursive = (
    binding: BindingId,
    block: BasicBlock,
    name: string,
  ): SsaIdentifier => {
    if (!sealed.has(block)) {
      const identifier = newVersion(binding, name);
      const phi: Phi = { identifier, operands: new Map() };
      let perBlock = incompletePhis.get(block);
      if (!perBlock) {
        perBlock = new Map();
        incompletePhis.set(block, perBlock);
      }
      perBlock.set(binding, phi);
      writeVariable(binding, block, identifier);
      return identifier;
    }
    if (block.predecessors.length === 1) {
      const value = readVariable(binding, block.predecessors[0]!.from, name);
      writeVariable(binding, block, value);
      return value;
    }
    if (block.predecessors.length === 0) {
      // Use of an unwritten binding (globals, use-before-def): a fresh,
      // operand-less version standing in for the undefined value.
      const identifier = newVersion(binding, name);
      writeVariable(binding, block, identifier);
      return identifier;
    }
    const identifier = newVersion(binding, name);
    const phi: Phi = { identifier, operands: new Map() };
    writeVariable(binding, block, identifier); // break cycles first
    addPhiOperands(binding, block, phi, name);
    recordPhi(block, phi);
    return identifier;
  };

  const readVariable = (binding: BindingId, block: BasicBlock, name: string): SsaIdentifier => {
    const local = currentDef.get(binding)?.get(block);
    if (local) return local;
    return readVariableRecursive(binding, block, name);
  };

  const sealBlock = (block: BasicBlock): void => {
    const incomplete = incompletePhis.get(block);
    if (incomplete) {
      for (const [binding, phi] of incomplete) {
        addPhiOperands(binding, block, phi, phi.identifier.name);
        recordPhi(block, phi);
      }
    }
    sealed.add(block);
  };

  const fillBlock = (block: BasicBlock): void => {
    for (const place of placesByBlock.get(block) ?? []) {
      if (place.kind === "read") {
        readIdentifierAt.set(place.node, readVariable(place.binding, block, place.name));
        continue;
      }
      const identifier = newVersion(place.binding, place.name);
      writeVariable(place.binding, block, identifier);
      writeIdentifierAt.set(place.node, identifier);
      let blocks = defBlocks.get(place.binding);
      if (!blocks) {
        blocks = new Set();
        defBlocks.set(place.binding, blocks);
      }
      blocks.add(block);
    }
    filled.add(block);
  };

  const order = reversePostorder(cfg.entry, successorBlocks);
  const allPredecessorsFilled = (block: BasicBlock): boolean =>
    block.predecessors.every((edge) => filled.has(edge.from));

  for (const block of order) {
    if (allPredecessorsFilled(block)) sealBlock(block);
    fillBlock(block);
  }
  // Seal the blocks left unsealed (loop headers, whose back-edge
  // predecessor was filled only after the header). Repeat to a fixpoint:
  // sealing a header can spawn incomplete φs on other unsealed blocks.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const block of order) {
      if (!sealed.has(block)) {
        sealBlock(block);
        progressed = true;
      }
    }
  }

  return { readIdentifierAt, writeIdentifierAt, defBlocks };
};
