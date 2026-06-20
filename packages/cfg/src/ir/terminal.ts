import type { EsTreeNode } from "../ast/es-tree-node.js";
import type { BasicBlock } from "./basic-block.js";

// How a `break` / `continue` goto resolved (React Compiler's GotoVariant);
// `normal` is plain fall-through to the next block.
export type GotoVariant = "normal" | "break" | "continue";

export interface TerminalCase {
  readonly test: EsTreeNode | null;
  readonly block: BasicBlock;
}

// The typed terminal that ends every basic block, modeling the React
// Compiler HIR terminal taxonomy (BuildHIR / HIR.ts). Branching terminals
// carry a `fallthrough` join block — the continuation where the construct's
// arms reconverge — exactly like the compiler's `TerminalWithFallthrough`.
// `break` / `continue` / `return` / `throw` are lowered to explicit
// terminals at their resolved targets, so the graph is fully explicit.
export type Terminal =
  | { readonly kind: "goto"; readonly block: BasicBlock; readonly variant: GotoVariant }
  | {
      readonly kind: "if";
      readonly test: EsTreeNode;
      readonly consequent: BasicBlock;
      readonly alternate: BasicBlock;
      readonly fallthrough: BasicBlock;
    }
  | {
      readonly kind: "switch";
      readonly discriminant: EsTreeNode;
      readonly cases: ReadonlyArray<TerminalCase>;
      readonly fallthrough: BasicBlock;
    }
  | {
      readonly kind: "while" | "do-while";
      readonly test: EsTreeNode | null;
      readonly body: BasicBlock;
      readonly fallthrough: BasicBlock;
    }
  | {
      readonly kind: "for" | "for-in" | "for-of";
      readonly body: BasicBlock;
      readonly fallthrough: BasicBlock;
    }
  | { readonly kind: "logical" | "ternary" | "optional"; readonly fallthrough: BasicBlock }
  | {
      readonly kind: "try";
      readonly block: BasicBlock;
      readonly handler: BasicBlock | null;
      readonly finalizer: BasicBlock | null;
      readonly fallthrough: BasicBlock;
    }
  | { readonly kind: "return"; readonly argument: EsTreeNode | null }
  | { readonly kind: "throw"; readonly argument: EsTreeNode }
  | { readonly kind: "unreachable" };
