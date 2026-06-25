import type { EsTreeNode } from "../ast/es-tree-node.js";
import { isFunctionLike } from "../ast/is-function-like.js";
import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";
import type { Place, ResolveBinding } from "../ir/place.js";
import { collectParameterPlaces, collectPlaces } from "./defs-uses.js";

// The ordered binding reads/writes of one function's CFG, bucketed into the
// block each occurrence executes in (`cfg.blockOf`). Parameters are written
// at the entry, before any body occurrence. This is the single source of
// truth feeding both SSA construction (`ssa.ts`) and the SSA-keyed dataflow
// analyses (`dataflow/definite-assignment.ts`) — both need the same
// per-block, evaluation-ordered occurrence stream.
export const collectPlacesByBlock = (
  cfg: FunctionCfg,
  owner: EsTreeNode,
  resolveBinding: ResolveBinding,
): Map<BasicBlock, Place[]> => {
  const parameters = isFunctionLike(owner) ? (owner.params as EsTreeNode[]) : [];
  const body = isFunctionLike(owner) ? (owner.body as EsTreeNode) : owner;
  const parameterPlaces = collectParameterPlaces(parameters, resolveBinding);
  const bodyPlaces = collectPlaces(body, resolveBinding);

  const placesByBlock = new Map<BasicBlock, Place[]>();
  const append = (block: BasicBlock, place: Place): void => {
    const existing = placesByBlock.get(block);
    if (existing) existing.push(place);
    else placesByBlock.set(block, [place]);
  };
  for (const place of parameterPlaces) append(cfg.entry, place);
  for (const place of bodyPlaces) {
    const block = cfg.blockOf(place.node);
    if (block) append(block, place);
  }
  return placesByBlock;
};
