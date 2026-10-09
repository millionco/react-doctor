import { collectRenderPropChangeKeys } from "./collect-render-prop-change-keys.js";
import { EFFECT_HOOK_NAMES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { resolveExpressionKey } from "./resolve-expression-key.js";
import type { RuleContext } from "./rule-context.js";
import { serializeReferenceKey } from "./serialize-reference-key.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

interface LoadingLifecycleReset {
  boundary: EsTreeNode;
  value: EsTreeNode;
  inactiveKeys: ReadonlySet<string>;
  onlyInactive: boolean;
  dependencies: ReadonlySet<string>;
}

export const collectLoadingLifecycleResets = (
  owner: EsTreeNode,
  setter: EsTreeNode,
  context: RuleContext,
): LoadingLifecycleReset[] => {
  const setterKey = resolveExpressionKey(setter, context);
  if (!setterKey) return [];
  const resets: LoadingLifecycleReset[] = [];
  const collectResetCalls = (callback: EsTreeNode, dependencyKeys: ReadonlySet<string>): void => {
    walkAst(isFunctionLike(callback) ? callback.body : callback, (child) => {
      if (isFunctionLike(child)) return false;
      if (
        !isNodeOfType(child, "CallExpression") ||
        resolveExpressionKey(child.callee, context) !== setterKey ||
        findEnclosingFunction(child) !==
          (isNodeOfType(callback, "BlockStatement") ? owner : callback)
      )
        return;
      const value = child.arguments[0];
      if (!value || isNodeOfType(value, "SpreadElement")) return;
      const inactiveKeys = new Set<string>();
      const collectInactiveKeys = (expression: EsTreeNode): void => {
        const candidateValue = stripParenExpression(expression);
        if (isNodeOfType(candidateValue, "LogicalExpression") && candidateValue.operator === "&&") {
          collectInactiveKeys(candidateValue.left);
          collectInactiveKeys(candidateValue.right);
        } else if (isNodeOfType(candidateValue, "Identifier")) {
          const key = serializeReferenceKey({ node: candidateValue, scopes: context.scopes });
          if (key) inactiveKeys.add(key);
        }
      };
      const onlyInactive = !(isNodeOfType(callback, "BlockStatement")
        ? isNodeOnUnconditionalPath(child, callback)
        : context.cfg.isUnconditionalFromEntry(child));
      if (onlyInactive) {
        if (!isNodeOfType(value, "Literal") || value.value !== false) return;
        let branch: EsTreeNode = child;
        while (
          branch.parent &&
          branch.parent !== callback &&
          !isNodeOfType(branch.parent, "IfStatement")
        )
          branch = branch.parent;
        const conditional = branch.parent;
        if (
          !isNodeOfType(conditional, "IfStatement") ||
          conditional.consequent !== branch ||
          conditional.alternate ||
          !context.cfg.isUnconditionalFromEntry(conditional) ||
          !isNodeOnUnconditionalPath(child, branch)
        )
          return;
        const test = stripParenExpression(conditional.test);
        if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return;
        collectInactiveKeys(test.argument);
      } else collectInactiveKeys(value);
      resets.push({
        value,
        dependencies: dependencyKeys,
        inactiveKeys,
        onlyInactive,
        boundary: callback,
      });
    });
  };
  walkOwnFunctionScope(owner, (candidate) => {
    if (
      isNodeOfType(candidate, "IfStatement") &&
      !candidate.alternate &&
      isNodeOfType(candidate.consequent, "BlockStatement") &&
      isNodeOnUnconditionalPath(candidate, owner) &&
      candidate.consequent.body.every((statement) => isNodeOfType(statement, "ExpressionStatement"))
    ) {
      const keys = collectRenderPropChangeKeys(
        candidate.test,
        candidate.consequent,
        context.scopes,
      );
      if (keys.length) collectResetCalls(candidate.consequent, new Set(keys));
      return;
    }
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isReactApiCall(candidate, EFFECT_HOOK_NAMES, context.scopes, {
        allowUnboundBareCalls: true,
        allowGlobalReactNamespace: true,
      })
    )
      return;
    const callback = candidate.arguments[0];
    const dependencies = candidate.arguments[1];
    if (
      !isFunctionLike(callback) ||
      callback.async ||
      callback.generator ||
      !isNodeOfType(dependencies, "ArrayExpression")
    )
      return;
    const dependencyKeys = new Set(
      dependencies.elements.flatMap((dependency) => {
        const key =
          dependency && serializeReferenceKey({ node: dependency, scopes: context.scopes });
        return key ? [key] : [];
      }),
    );
    collectResetCalls(callback, dependencyKeys);
  });
  return resets;
};
