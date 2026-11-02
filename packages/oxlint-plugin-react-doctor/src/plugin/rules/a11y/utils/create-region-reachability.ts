import {
  getStaticBooleanValue,
  type BasicBlock,
  type FunctionCfg,
} from "../../../semantic/control-flow-graph.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { REGION_CONDITIONAL_BRANCH_COUNT } from "./constants.js";

const createStaticBranchView = (functionCfg: FunctionCfg): FunctionCfg => {
  const excludedTargets = new Map<BasicBlock, BasicBlock>();
  walkAst(functionCfg.owner, (node) => {
    if (node !== functionCfg.owner && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "IfStatement")) return;
    const testValue = getStaticBooleanValue(node.test);
    if (testValue === null) return;
    const sourceBlock = functionCfg.blockOf(node);
    const consequentBlock = functionCfg.blockOf(node.consequent);
    if (!sourceBlock || !consequentBlock) return;
    const conditionalEdges = sourceBlock.successors.filter((edge) => edge.kind === "cond");
    if (conditionalEdges.length !== REGION_CONDITIONAL_BRANCH_COUNT) return;
    const consequentEdge = conditionalEdges.find((edge) => edge.to === consequentBlock);
    const alternateEdge = conditionalEdges.find((edge) => edge.to !== consequentBlock);
    if (!consequentEdge || !alternateEdge) return;
    excludedTargets.set(sourceBlock, testValue ? alternateEdge.to : consequentEdge.to);
  });
  if (excludedTargets.size === 0) return functionCfg;

  const blockViews = new Map<BasicBlock, BasicBlock>();
  for (const block of functionCfg.blocks) {
    blockViews.set(block, { ...block, successors: [], predecessors: [] });
  }
  for (const block of functionCfg.blocks) {
    const sourceView = blockViews.get(block);
    if (!sourceView) continue;
    for (const edge of block.successors) {
      if (edge.kind === "cond" && excludedTargets.get(block) === edge.to) continue;
      const targetView = blockViews.get(edge.to);
      if (!targetView) continue;
      const edgeView = { ...edge, from: sourceView, to: targetView };
      sourceView.successors.push(edgeView);
      targetView.predecessors.push(edgeView);
    }
  }
  return {
    ...functionCfg,
    entry: blockViews.get(functionCfg.entry) ?? functionCfg.entry,
    exit: blockViews.get(functionCfg.exit) ?? functionCfg.exit,
    blocks: [...blockViews.values()],
    blockOf: (node) => {
      const block = functionCfg.blockOf(node);
      return block ? (blockViews.get(block) ?? null) : null;
    },
  };
};

const exitsOwningTry = (
  node: EsTreeNodeOfType<"BreakStatement"> | EsTreeNodeOfType<"ContinueStatement">,
  owningTry: EsTreeNodeOfType<"TryStatement">,
): boolean => {
  if (node.label) return false;
  let ancestor = node.parent;
  while (ancestor) {
    if (ancestor === owningTry) return true;
    if (
      isNodeOfType(ancestor, "ForStatement") ||
      isNodeOfType(ancestor, "ForInStatement") ||
      isNodeOfType(ancestor, "ForOfStatement") ||
      isNodeOfType(ancestor, "WhileStatement") ||
      isNodeOfType(ancestor, "DoWhileStatement") ||
      (isNodeOfType(node, "BreakStatement") && isNodeOfType(ancestor, "SwitchStatement"))
    ) {
      return false;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const createRegionReachability = (context: RuleContext): ((node: EsTreeNode) => boolean) => {
  const branchViews = new WeakMap<FunctionCfg, FunctionCfg>();
  const finalizerEntries = new WeakMap<EsTreeNode, BasicBlock | null>();
  let branchContext: RuleContext | undefined;

  const isReachable = (node: EsTreeNode): boolean => {
    if (!branchContext) {
      const originalControlFlow = context.cfg;
      branchContext = {
        report: context.report,
        settings: context.settings,
        get filename() {
          return context.filename;
        },
        get sourceCode() {
          return context.sourceCode;
        },
        get scopes() {
          return context.scopes;
        },
        cfg: {
          ...originalControlFlow,
          cfgFor: (owner) => {
            const functionCfg = originalControlFlow.cfgFor(owner);
            if (!functionCfg) return null;
            let branchView = branchViews.get(functionCfg);
            if (!branchView) {
              branchView = createStaticBranchView(functionCfg);
              branchViews.set(functionCfg, branchView);
            }
            return branchView;
          },
        },
      };
    }
    const activeContext = branchContext;
    if (isNodeReachableWithinFunction(node, activeContext)) return true;
    const owner = activeContext.cfg.enclosingFunction(node);
    const functionCfg = owner ? activeContext.cfg.cfgFor(owner) : null;
    if (!owner || !functionCfg) return false;
    let child = node;
    let ancestor = node.parent;
    while (ancestor && ancestor !== owner) {
      if (isNodeOfType(ancestor, "TryStatement") && ancestor.finalizer === child) {
        const owningTry = ancestor;
        if (!isReachable(owningTry)) return false;
        let finalizerEntry = finalizerEntries.get(owningTry);
        if (finalizerEntry === undefined) {
          let hasReachableExit = false;
          let hasReachableThrow = false;
          walkAst(owningTry.block, (candidate) => {
            if (hasReachableThrow) return false;
            if (isFunctionLike(candidate) || isNodeOfType(candidate, "TryStatement")) return false;
            if (isNodeOfType(candidate, "ThrowStatement") && isReachable(candidate)) {
              hasReachableThrow = true;
            }
          });
          for (const body of [owningTry.block, owningTry.handler?.body]) {
            if (!body) continue;
            if (body === owningTry.handler?.body && !hasReachableThrow) continue;
            walkAst(body, (candidate) => {
              if (hasReachableExit) return false;
              if (isFunctionLike(candidate) || isNodeOfType(candidate, "TryStatement"))
                return false;
              if (
                (isNodeOfType(candidate, "ReturnStatement") ||
                  (body === owningTry.handler?.body && isNodeOfType(candidate, "ThrowStatement")) ||
                  ((isNodeOfType(candidate, "BreakStatement") ||
                    isNodeOfType(candidate, "ContinueStatement")) &&
                    exitsOwningTry(candidate, owningTry))) &&
                isReachable(candidate)
              ) {
                hasReachableExit = true;
              }
            });
          }
          const firstStatement = owningTry.finalizer?.body[0];
          finalizerEntry =
            hasReachableExit && firstStatement ? functionCfg.blockOf(firstStatement) : null;
          finalizerEntries.set(owningTry, finalizerEntry);
        }
        if (!finalizerEntry) return false;
        const queryEntry = finalizerEntry;
        // HACK: The shared CFG bypasses finalizers for these abrupt exits; only this query's entry changes.
        const finalizerContext: RuleContext = {
          ...activeContext,
          cfg: {
            ...activeContext.cfg,
            cfgFor: (functionLike) =>
              functionLike === owner
                ? { ...functionCfg, entry: queryEntry }
                : activeContext.cfg.cfgFor(functionLike),
          },
        };
        return isNodeReachableWithinFunction(node, finalizerContext);
      }
      child = ancestor;
      ancestor = ancestor.parent;
    }
    return false;
  };
  return isReachable;
};
