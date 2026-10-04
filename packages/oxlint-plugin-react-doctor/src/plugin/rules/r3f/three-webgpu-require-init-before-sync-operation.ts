import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isAwaitedCallExpression } from "../../utils/is-awaited-call-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface RendererMethodCall {
  readonly methodName: string;
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly owner: EsTreeNode | null;
  readonly rendererSymbol: SymbolDescriptor;
}

const SYNCHRONOUS_INITIALIZED_RENDERER_METHOD_NAMES: ReadonlySet<string> = new Set([
  "clear",
  "clearColor",
  "clearDepth",
  "clearStencil",
  "hasCompatibility",
  "hasFeature",
  "initRenderTarget",
  "initTexture",
  "render",
  "resetState",
]);

const resolveRendererSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): SymbolDescriptor | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return null;
  visitedSymbolIds.add(symbol.id);
  if (isNodeOfType(stripParenExpression(initializer), "Identifier")) {
    return resolveRendererSymbol(initializer, context, visitedSymbolIds);
  }
  return getThreeConstructorName(initializer, context.scopes) === "WebGPURenderer" ? symbol : null;
};

export const threeWebgpuRequireInitBeforeSyncOperation = defineRule({
  id: "three-webgpu-require-init-before-sync-operation",
  title: "WebGPU renderer used before asynchronous initialization",
  category: "Correctness",
  requires: ["three:181"],
  severity: "error",
  recommendation: "Await renderer.init() before calling synchronous WebGPU renderer methods",
  create: (context: RuleContext) => {
    const initializationCalls: RendererMethodCall[] = [];
    const operationCalls: RendererMethodCall[] = [];
    let program: EsTreeNodeOfType<"Program"> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        const methodName = getStaticPropertyName(node.callee);
        if (
          methodName !== "init" &&
          !SYNCHRONOUS_INITIALIZED_RENDERER_METHOD_NAMES.has(methodName ?? "")
        ) {
          return;
        }
        const rendererSymbol = resolveRendererSymbol(node.callee.object, context);
        const initializer = rendererSymbol
          ? getDirectUnreassignedInitializer(rendererSymbol)
          : null;
        if (!rendererSymbol || !initializer) return;
        const owner = context.cfg.enclosingFunction(node);
        if (owner !== context.cfg.enclosingFunction(initializer)) return;
        const call = { methodName: methodName ?? "", node, owner, rendererSymbol };
        if (methodName === "init") {
          if (isAwaitedCallExpression(node)) initializationCalls.push(call);
          return;
        }
        operationCalls.push(call);
      },
      "Program:exit"() {
        if (!program) return;
        const programNode = program;
        for (const operation of operationCalls) {
          const operationStart = getRangeStart(operation.node);
          if (operationStart === null) continue;
          const isInitialized = initializationCalls.some((initialization) => {
            const initializationStart = getRangeStart(initialization.node);
            return (
              initialization.rendererSymbol.id === operation.rendererSymbol.id &&
              initialization.owner === operation.owner &&
              initializationStart !== null &&
              initializationStart < operationStart &&
              !isNodeConditionallyExecuted(initialization.node, operation.owner ?? programNode)
            );
          });
          if (isInitialized) continue;
          context.report({
            node: operation.node,
            message: `WebGPURenderer.${operation.methodName}() is called before a provable awaited renderer.init(), so the synchronous API can throw while the backend is uninitialized`,
          });
        }
      },
    };
  },
});
