import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const SHADER_MATERIAL_INTRINSIC_NAMES: ReadonlySet<string> = new Set([
  "rawShaderMaterial",
  "shaderMaterial",
]);

const resolveUniformSourceRootSymbolId = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): number | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  if (
    symbol.kind === "const" &&
    symbol.initializer &&
    isNodeOfType(stripParenExpression(symbol.initializer), "Identifier")
  ) {
    return resolveUniformSourceRootSymbolId(symbol.initializer, scopes, visitedSymbolIds);
  }
  return symbol.id;
};

const getMemberRoot = (expression: EsTreeNode): EsTreeNode => {
  let candidate = stripParenExpression(expression);
  while (isNodeOfType(candidate, "MemberExpression")) {
    candidate = stripParenExpression(candidate.object);
  }
  return candidate;
};

const mutationTargetsUniformSource = (
  expression: EsTreeNode,
  sourceSymbolIds: ReadonlySet<number>,
  scopes: ScopeAnalysis,
): boolean => {
  const root = getMemberRoot(expression);
  if (!isNodeOfType(root, "Identifier")) return false;
  const rootSymbolId = resolveUniformSourceRootSymbolId(root, scopes);
  return rootSymbolId !== null && sourceSymbolIds.has(rootSymbolId);
};

export const r3fNoMutateUniformPropSourceInUseFrame = defineRule({
  id: "r3f-no-mutate-uniform-prop-source-in-use-frame",
  title: "R3F uniform prop source mutated after being copied",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Mutate materialRef.current.uniforms inside useFrame instead of the object passed to uniforms",
  create: (context: RuleContext) => ({
    Program(program: EsTreeNodeOfType<"Program">) {
      const sourceSymbolIds = new Set<number>();
      const callbacks = new Set<EsTreeNode>();
      walkAst(program, (candidate) => {
        if (isNodeOfType(candidate, "JSXOpeningElement")) {
          if (
            !isNodeOfType(candidate.name, "JSXIdentifier") ||
            !SHADER_MATERIAL_INTRINSIC_NAMES.has(candidate.name.name)
          ) {
            return;
          }
          const uniformsExpression = getJsxAttributeExpression(candidate, "uniforms");
          if (!uniformsExpression) return;
          const sourceSymbolId = resolveUniformSourceRootSymbolId(
            uniformsExpression,
            context.scopes,
          );
          if (sourceSymbolId !== null) sourceSymbolIds.add(sourceSymbolId);
          return;
        }
        if (!isNodeOfType(candidate, "CallExpression")) return;
        const callback = resolveR3fCallback(candidate, "useFrame", context.scopes);
        if (callback) callbacks.add(callback);
      });
      if (sourceSymbolIds.size === 0) return;
      for (const callback of callbacks) {
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          const mutationTarget = isNodeOfType(candidate, "AssignmentExpression")
            ? candidate.left
            : isNodeOfType(candidate, "UpdateExpression")
              ? candidate.argument
              : null;
          if (
            !mutationTarget ||
            !mutationTargetsUniformSource(mutationTarget, sourceSymbolIds, context.scopes)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "R3F copied this uniforms prop into the material, so mutating the source object in useFrame does not update the shader. Mutate the material ref's uniforms instead",
          });
        });
      }
    },
  }),
});
