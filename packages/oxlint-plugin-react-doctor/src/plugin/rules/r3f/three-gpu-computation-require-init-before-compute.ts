import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../utils/node-dominates-node.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

interface GpuComputationCall {
  readonly computationKey: string;
  readonly node: EsTreeNodeOfType<"CallExpression">;
}

interface GpuComputationOperation extends GpuComputationCall {
  readonly orderingAnchor: EsTreeNodeOfType<"CallExpression">;
}

const getGpuComputationCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  methodName: string,
  context: RuleContext,
): GpuComputationCall | null => {
  if (
    !isNodeOfType(node.callee, "MemberExpression") ||
    getStaticPropertyName(node.callee) !== methodName ||
    getThreeConstructorName(node.callee.object, context.scopes) !== "GPUComputationRenderer"
  ) {
    return null;
  }
  const computationKey = resolveExpressionKey(node.callee.object, context);
  return computationKey ? { computationKey, node } : null;
};

const initializationDominatesOperation = (
  initialization: GpuComputationCall,
  operation: GpuComputationOperation,
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): boolean => {
  if (initialization.computationKey !== operation.computationKey) return false;
  const initializationOwner = context.cfg.enclosingFunction(initialization.node);
  const operationOwner = context.cfg.enclosingFunction(operation.orderingAnchor);
  if (initializationOwner !== operationOwner) return false;
  if (initializationOwner) {
    return nodeDominatesNode(initialization.node, operation.orderingAnchor, context);
  }
  const initializationStart = getRangeStart(initialization.node);
  const operationStart = getRangeStart(operation.orderingAnchor);
  return Boolean(
    initializationStart !== null &&
    operationStart !== null &&
    initializationStart < operationStart &&
    !isNodeConditionallyExecuted(initialization.node, program),
  );
};

export const threeGpuComputationRequireInitBeforeCompute = defineRule({
  id: "three-gpu-computation-require-init-before-compute",
  title: "GPU computation runs before initialization",
  category: "Correctness",
  severity: "error",
  recommendation: "Call and validate GPUComputationRenderer.init() before scheduling compute()",
  create: (context: RuleContext) => {
    const initializations: GpuComputationCall[] = [];
    const operations: GpuComputationOperation[] = [];
    const nestedComputeNodes = new Set<EsTreeNode>();
    let program: EsTreeNodeOfType<"Program"> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const initialization = getGpuComputationCall(node, "init", context);
        if (initialization) initializations.push(initialization);
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (callback) {
          walkFunctionExecution(callback, context.scopes, (candidate) => {
            if (!isNodeOfType(candidate, "CallExpression")) return;
            const compute = getGpuComputationCall(candidate, "compute", context);
            if (!compute || nestedComputeNodes.has(candidate)) return;
            nestedComputeNodes.add(candidate);
            operations.push({ ...compute, orderingAnchor: node });
          });
        }
        const compute = getGpuComputationCall(node, "compute", context);
        if (compute && !nestedComputeNodes.has(node)) {
          operations.push({ ...compute, orderingAnchor: node });
        }
      },
      "Program:exit"() {
        if (!program) return;
        const currentProgram = program;
        for (const operation of operations) {
          if (
            initializations.some((initialization) =>
              initializationDominatesOperation(initialization, operation, currentProgram, context),
            )
          ) {
            continue;
          }
          context.report({
            node: operation.node,
            message:
              "GPUComputationRenderer.compute() can run before a dominating init() call, so its variables and ping-pong render targets may be unavailable",
          });
        }
      },
    };
  },
});
