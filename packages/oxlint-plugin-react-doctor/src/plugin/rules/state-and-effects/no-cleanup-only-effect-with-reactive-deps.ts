import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isFunctionLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression");

// A cleanup-only effect body returns a teardown function and does
// nothing else: either a concise arrow body that IS a function, or a
// block whose single statement returns a function.
const getCleanupOnlyReturn = (effectCallback: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(effectCallback, "FunctionExpression")
  ) {
    return null;
  }
  const body = effectCallback.body;
  if (!isNodeOfType(body, "BlockStatement")) {
    const concise = stripParenExpression(body);
    return isFunctionLiteral(concise) ? concise : null;
  }
  const statements = body.body ?? [];
  if (statements.length !== 1) return null;
  const [onlyStatement] = statements;
  if (!isNodeOfType(onlyStatement, "ReturnStatement") || !onlyStatement.argument) return null;
  const returned = stripParenExpression(onlyStatement.argument);
  return isFunctionLiteral(returned) ? returned : null;
};

const findEnclosingComponentFunction = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (
      isNodeOfType(cursor, "ArrowFunctionExpression") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "FunctionDeclaration")
    ) {
      return cursor;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isFreshAllocationExpression = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  return (
    isNodeOfType(stripped, "ObjectExpression") ||
    isNodeOfType(stripped, "ArrayExpression") ||
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression") ||
    isNodeOfType(stripped, "NewExpression")
  );
};

// A dep Identifier whose binding is an unconditional render-local
// `const/let/var name = <fresh allocation>` — a new identity every
// render. Module-scope bindings and opaque call results (useMemo,
// useRef, useState, custom hooks) are stable enough to skip.
const isRenderLocalFreshIdentity = (depIdentifier: EsTreeNode): boolean => {
  if (!isNodeOfType(depIdentifier, "Identifier")) return false;
  const binding = findVariableInitializer(depIdentifier, depIdentifier.name);
  if (!binding || !binding.initializer) return false;
  if (binding.scopeOwner.type === "Program") return false;
  const declarator = binding.bindingIdentifier.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== binding.initializer
  ) {
    return false;
  }
  return isFreshAllocationExpression(binding.initializer);
};

interface EnclosingPropNames {
  wholePropsParamName: string | null;
  destructuredPropNames: Set<string>;
}

const getEnclosingPropNames = (effectCall: EsTreeNode): EnclosingPropNames => {
  const componentFunction = findEnclosingComponentFunction(effectCall);
  const destructuredPropNames = new Set<string>();
  let wholePropsParamName: string | null = null;
  if (
    componentFunction &&
    (isNodeOfType(componentFunction, "ArrowFunctionExpression") ||
      isNodeOfType(componentFunction, "FunctionExpression") ||
      isNodeOfType(componentFunction, "FunctionDeclaration"))
  ) {
    const params = componentFunction.params ?? [];
    const firstParam = params[0];
    if (firstParam && isNodeOfType(firstParam, "Identifier")) {
      wholePropsParamName = firstParam.name;
    }
    for (const param of params) {
      collectPatternNames(param, destructuredPropNames);
    }
  }
  return { wholePropsParamName, destructuredPropNames };
};

export const noCleanupOnlyEffectWithReactiveDeps = defineRule({
  id: "no-cleanup-only-effect-with-reactive-deps",
  title: "Cleanup-only effect depends on reactive values",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "A useEffect whose whole body is a `return () => {...}` cleanup runs its teardown before every re-run, so listing a reactive value (the whole props object, a prop, or a value rebuilt each render) makes it fire on every render, which infinite-loops if the cleanup sets state or calls a parent callback. Use `[]` if the teardown truly only needs to run on unmount, or move the cleanup body into useEffectEvent.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const args = node.arguments ?? [];
      if (args.length !== 2) return;
      const callback = args[0];
      if (!callback || !getCleanupOnlyReturn(callback)) return;

      const depsNode = stripParenExpression(args[1]);
      if (!isNodeOfType(depsNode, "ArrayExpression")) return;
      const depElements = depsNode.elements ?? [];
      if (depElements.length === 0) return;

      const { wholePropsParamName, destructuredPropNames } = getEnclosingPropNames(node);

      for (const depElement of depElements) {
        if (!depElement || isNodeOfType(depElement, "SpreadElement")) continue;
        const stripped = stripParenExpression(depElement);

        if (isNodeOfType(stripped, "Identifier")) {
          if (wholePropsParamName !== null && stripped.name === wholePropsParamName) {
            context.report({
              node: depElement,
              message: `This cleanup-only effect depends on the whole \`${stripped.name}\` object, whose identity changes every render, so the teardown runs on every render instead of only on unmount; use \`[]\` or move the cleanup into useEffectEvent.`,
            });
            continue;
          }
          if (destructuredPropNames.has(stripped.name)) {
            context.report({
              node: depElement,
              message: `This cleanup-only effect depends on the reactive prop \`${stripped.name}\`, so the teardown runs on every change instead of only on unmount, which loops if the cleanup sets state or calls a parent callback; use \`[]\` or useEffectEvent.`,
            });
            continue;
          }
          if (isRenderLocalFreshIdentity(stripped)) {
            context.report({
              node: depElement,
              message: `This cleanup-only effect depends on \`${stripped.name}\`, which is rebuilt fresh every render, so the teardown runs on every render instead of only on unmount; use \`[]\` or wrap the value in useMemo.`,
            });
          }
          continue;
        }

        if (
          isNodeOfType(stripped, "MemberExpression") &&
          wholePropsParamName !== null &&
          isNodeOfType(stripped.object, "Identifier") &&
          stripped.object.name === wholePropsParamName
        ) {
          context.report({
            node: depElement,
            message: `This cleanup-only effect depends on the reactive prop \`${wholePropsParamName}.${
              isNodeOfType(stripped.property, "Identifier") ? stripped.property.name : "value"
            }\`, so the teardown runs on every change instead of only on unmount; use \`[]\` or useEffectEvent.`,
          });
        }
      }
    },
  }),
});
