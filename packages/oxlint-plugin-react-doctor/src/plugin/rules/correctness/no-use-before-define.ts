import { REACT_DEPENDENCY_ARRAY_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { getValueImportDeclaration } from "../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

export const noUseBeforeDefine = defineRule({
  id: "no-use-before-define",
  title: "Hook dependency read before initialization",
  severity: "error",
  diffScope: "line",
  requires: ["react"],
  recommendation:
    "Move the local declaration above the Hook call. Dependency arrays read their values immediately, even when the callback runs later.",
  create: (context) => ({
    CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
      if (node.optional || !isReactApiCall(node, REACT_DEPENDENCY_ARRAY_HOOK_NAMES, context.scopes))
        return;
      const calleeIdentifier = getRootIdentifier(node.callee);
      const calleeSymbol = calleeIdentifier ? context.scopes.symbolFor(calleeIdentifier) : null;
      if (!calleeSymbol || !getValueImportDeclaration(calleeSymbol)) return;
      const [callbackArgument, dependencyArgument] = node.arguments;
      if (!callbackArgument || !dependencyArgument) return;
      const callback = stripParenExpression(callbackArgument);
      const dependencies = stripParenExpression(dependencyArgument);
      if (!isFunctionLike(callback) || !isNodeOfType(dependencies, "ArrayExpression")) return;
      const owner = findRenderPhaseComponentOrHook(node, context.scopes);
      if (
        !isFunctionLike(owner) ||
        !isNodeOfType(owner.body, "BlockStatement") ||
        findEnclosingFunction(node) !== owner ||
        !isNodeReachableWithinFunction(node, context)
      ) {
        return;
      }
      const callRoot = findTransparentExpressionRoot(node);
      const parent = callRoot.parent;
      const statement =
        isNodeOfType(parent, "VariableDeclarator") && parent.init === callRoot
          ? parent.parent
          : parent;
      if (
        (!isNodeOfType(statement, "VariableDeclaration") &&
          !isNodeOfType(statement, "ExpressionStatement")) ||
        statement.parent !== owner.body
      ) {
        return;
      }
      for (const dependencyElement of dependencies.elements) {
        if (!dependencyElement) continue;
        const dependency = stripParenExpression(dependencyElement);
        if (!isNodeOfType(dependency, "Identifier")) continue;
        const symbol = context.scopes.symbolFor(dependency);
        if (!symbol || (symbol.kind !== "const" && symbol.kind !== "let")) continue;
        const declarator = symbol.declarationNode;
        if (
          !isNodeOfType(declarator, "VariableDeclarator") ||
          !isNodeOfType(declarator.id, "Identifier") ||
          !isNodeOfType(declarator.parent, "VariableDeclaration") ||
          declarator.parent.parent !== owner.body
        ) {
          continue;
        }
        const [dependencyStart] = dependency.range;
        const [, declarationEnd] = declarator.range;
        if (dependencyStart >= declarationEnd) continue;
        context.report({
          node: dependency,
          contextNodes: [node, declarator],
          message: `Evaluating this dependency reads \`${dependency.name}\` before its local ${symbol.kind} is initialized, which throws a ReferenceError. Move its declaration above this Hook call.`,
        });
      }
    },
  }),
});
