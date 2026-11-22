import { analyzeControlFlow } from "../../../semantic/control-flow-graph.js";
import type { ControlFlowAnalysis } from "../../../semantic/control-flow-graph.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeConditionallyExecuted } from "../../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../../../utils/is-react-component-or-hook-name.js";

const controlFlowByProgram = new WeakMap<EsTreeNode, ControlFlowAnalysis>();

const isModuleDeclaration = (declaration: EsTreeNode): boolean => {
  const host = declaration.parent;
  return (
    isNodeOfType(host, "Program") ||
    ((isNodeOfType(host, "ExportNamedDeclaration") ||
      isNodeOfType(host, "ExportDefaultDeclaration")) &&
      isNodeOfType(host.parent, "Program"))
  );
};

export const isUnconditionalServiceHookConsumer = (
  call: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  if (call.optional) return false;
  let owner = call.parent;
  while (owner && !isFunctionLike(owner)) owner = owner.parent;
  if (
    !owner ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement")
  )
    return false;
  let name: string | null = null;
  if (isNodeOfType(owner, "FunctionDeclaration") && owner.id && isModuleDeclaration(owner)) {
    name = owner.id.name;
  } else if (
    isNodeOfType(owner.parent, "VariableDeclarator") &&
    owner.parent.init === owner &&
    isNodeOfType(owner.parent.id, "Identifier") &&
    isNodeOfType(owner.parent.parent, "VariableDeclaration") &&
    owner.parent.parent.kind === "const" &&
    isModuleDeclaration(owner.parent.parent)
  ) {
    name = owner.parent.id.name;
  }
  if (!name || !isReactComponentOrHookName(name) || isNodeConditionallyExecuted(call, owner))
    return false;

  // An imported call may live in a file the lint invocation excluded. Waive
  // the defining diagnostic only for verified render/Hooks placement there.
  const parent = call.parent;
  const statement =
    isNodeOfType(parent, "ExpressionStatement") && parent.expression === call
      ? parent
      : isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === call &&
          isNodeOfType(parent.parent, "VariableDeclaration") &&
          parent.parent.declarations.length === 1
        ? parent.parent
        : null;
  if (statement?.parent !== owner.body) return false;
  const program = findProgramRoot(owner);
  if (!program) return false;
  let cfg = controlFlowByProgram.get(program);
  if (!cfg) {
    cfg = analyzeControlFlow(program);
    controlFlowByProgram.set(program, cfg);
  }
  return cfg.isUnconditionalFromEntry(call);
};
