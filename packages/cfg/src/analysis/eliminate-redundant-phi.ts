import type { FunctionCfg } from "../ir/basic-block.js";
import type { Phi, SsaIdentifier } from "../ir/place.js";
import type { SsaConstruction } from "./enter-ssa.js";
import { successorBlocks } from "./block-edges.js";
import { reversePostorder } from "./reverse-postorder.js";

// Strip the trivial φs the on-the-fly builder leaves behind — a φ whose
// operands are all the same value `v` (ignoring self-references) is just
// `v`. Ports the React Compiler's `EliminateRedundantPhi`: a reverse-
// postorder rewrite pass repeated to a fixpoint, since collapsing one φ can
// expose another. Mutates the CFG's `block.phis` and rewrites every
// recorded read/write occurrence through the resulting substitution.
export const eliminateRedundantPhis = (cfg: FunctionCfg, construction: SsaConstruction): void => {
  const order = reversePostorder(cfg.entry, successorBlocks);
  const rewrite = new Map<SsaIdentifier, SsaIdentifier>();
  const removed = new Set<Phi>();

  const resolve = (identifier: SsaIdentifier): SsaIdentifier => {
    let current = identifier;
    while (rewrite.has(current)) current = rewrite.get(current)!;
    return current;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const block of order) {
      for (const phi of block.phis) {
        if (removed.has(phi)) continue;
        let unique: SsaIdentifier | null = null;
        let redundant = true;
        for (const operand of phi.operands.values()) {
          const resolved = resolve(operand);
          if (resolved === phi.identifier) continue; // self-reference: ignore
          if (unique === null) {
            unique = resolved;
          } else if (unique !== resolved) {
            redundant = false;
            break;
          }
        }
        if (redundant && unique !== null) {
          rewrite.set(phi.identifier, unique);
          removed.add(phi);
          changed = true;
        }
      }
    }
  }

  for (const block of order) {
    const kept = block.phis.filter((phi) => !removed.has(phi));
    block.phis.length = 0;
    for (const phi of kept) {
      for (const [predecessor, operand] of phi.operands) {
        phi.operands.set(predecessor, resolve(operand));
      }
      block.phis.push(phi);
    }
  }

  for (const [node, identifier] of construction.readIdentifierAt) {
    construction.readIdentifierAt.set(node, resolve(identifier));
  }
  for (const [node, identifier] of construction.writeIdentifierAt) {
    construction.writeIdentifierAt.set(node, resolve(identifier));
  }
};
