import type { EsTreeNode } from "../ast/es-tree-node.js";
import { isNodeOfType } from "../ast/is-node-of-type.js";
import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";
import {
  addEdge,
  appendInstruction,
  createBlock,
  createBuilder,
  setTerminal,
} from "./cfg-builder.js";
import { buildSubExpression } from "./build-expression.js";
import { buildStatements } from "./build-statement.js";

// Back-fill the terminal of every block that merely falls through: a
// single successor becomes a `goto` (normal variant); a block with no
// successor keeps the `unreachable` sentinel (a genuine orphan or the
// function exit). Branching blocks already carry an explicit terminal.
const finalizeTerminals = (blocks: ReadonlyArray<BasicBlock>, exit: BasicBlock): void => {
  for (const block of blocks) {
    if (block === exit) continue;
    if (block.terminal.kind !== "unreachable") continue;
    if (block.successors.length === 1) {
      setTerminal(block, { kind: "goto", block: block.successors[0]!.to, variant: "normal" });
    }
  }
};

export const buildFunctionCfg = (functionNode: EsTreeNode, body: EsTreeNode): FunctionCfg => {
  const builder = createBuilder();
  const entry = createBlock(builder);
  const exit = createBlock(builder);
  builder.entry = entry;
  builder.exit = exit;

  let bodyEnd: BasicBlock;
  if (isNodeOfType(body, "BlockStatement") || isNodeOfType(body, "Program")) {
    bodyEnd = buildStatements(builder, body.body as EsTreeNode[], entry);
  } else {
    // Arrow expression body: a single Expression. Lower its control flow so
    // `() => cond ? useA() : useB()` sees the hooks as conditional.
    bodyEnd = buildSubExpression(builder, body, entry);
  }
  // Implicit return / fall-off the end of the function body.
  addEdge(bodyEnd, exit, "uncond");
  if (bodyEnd.terminal.kind === "unreachable") {
    appendInstruction(bodyEnd, body, "implicit-return");
    setTerminal(bodyEnd, { kind: "return", argument: null });
  }
  finalizeTerminals(builder.blocks, exit);

  const blockOf = (node: EsTreeNode): BasicBlock | null => builder.nodeBlock.get(node) ?? null;

  return {
    owner: functionNode,
    entry,
    exit,
    blocks: builder.blocks,
    blockOf,
  };
};
