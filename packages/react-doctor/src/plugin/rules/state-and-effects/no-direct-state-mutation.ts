import { MUTATING_ARRAY_METHODS } from "../../constants/js.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: walks the component AST while tracking which state names are
// SHADOWED in the current scope by a nested function's params or
// var/let/const declarations. Without this, a handler that locally
// re-binds the state name (e.g. `const items = raw.split(",")` then
// `items.push(x)`) gets falsely flagged. We don't do real scope
// analysis (would need eslint-utils' ScopeManager) — just lexical
// param + top-level binding collection per function, which covers the
// >99% of real-world shadowing cases without false positives.
const collectFunctionLocalBindings = (functionNode: EsTreeNode): Set<string> => {
  const localBindings = new Set<string>();
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    return localBindings;
  }
  for (const param of functionNode.params ?? []) {
    collectPatternNames(param, localBindings);
  }
  if (isNodeOfType(functionNode.body, "BlockStatement")) {
    for (const statement of functionNode.body.body ?? []) {
      if (!isNodeOfType(statement, "VariableDeclaration")) continue;
      for (const declarator of statement.declarations ?? []) {
        collectPatternNames(declarator.id, localBindings);
      }
    }
  }
  return localBindings;
};

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const walkComponentRespectingShadows = (
  node: EsTreeNode,
  shadowedStateNames: ReadonlySet<string>,
  visit: (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>) => void,
): void => {
  if (!node || typeof node !== "object") return;

  let nextShadowedStateNames = shadowedStateNames;
  if (isFunctionLikeNode(node)) {
    const localBindings = collectFunctionLocalBindings(node);
    if (localBindings.size > 0) {
      const merged = new Set(shadowedStateNames);
      for (const localName of localBindings) merged.add(localName);
      nextShadowedStateNames = merged;
    }
  }

  visit(node, shadowedStateNames);

  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) {
          walkComponentRespectingShadows(item as EsTreeNode, nextShadowedStateNames, visit);
        }
      }
    } else if (child && typeof child === "object" && "type" in child) {
      walkComponentRespectingShadows(child as EsTreeNode, nextShadowedStateNames, visit);
    }
  }
};

export const noDirectStateMutation = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Replace the mutation with a setter call that produces a new reference: `setItems([...items, newItem])`, `setItems(items.filter(x => x !== target))`, `setItems(items.toSorted(...))`. React only re-renders on a new reference, so in-place updates are silently dropped",
  examples: [
    {
      before: "items.push(newItem);\nsetItems(items);",
      after: "setItems([...items, newItem]);",
    },
  ],
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const bindings = collectUseStateBindings(componentBody);
      if (bindings.length === 0) return;

      const stateValueToSetter = new Map<string, string>(
        bindings.map((binding) => [binding.valueName, binding.setterName] as const),
      );

      walkComponentRespectingShadows(
        componentBody,
        new Set(),
        (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>) => {
          if (isNodeOfType(child, "AssignmentExpression")) {
            if (!isNodeOfType(child.left, "MemberExpression")) return;
            const rootName = getRootIdentifierName(child.left);
            if (!rootName || !stateValueToSetter.has(rootName)) return;
            if (currentlyShadowed.has(rootName)) return;
            const setterName = stateValueToSetter.get(rootName);
            context.report({
              node: child,
              message: `Direct property assignment on useState value "${rootName}" — call ${setterName} with a new value; React only re-renders on a new reference`,
            });
            return;
          }

          if (isNodeOfType(child, "CallExpression")) {
            const callee = child.callee;
            if (!isNodeOfType(callee, "MemberExpression")) return;
            if (!isNodeOfType(callee.property, "Identifier")) return;
            const methodName = callee.property.name;
            if (!MUTATING_ARRAY_METHODS.has(methodName)) return;
            const rootName = getRootIdentifierName(callee.object);
            if (!rootName || !stateValueToSetter.has(rootName)) return;
            if (currentlyShadowed.has(rootName)) return;
            const setterName = stateValueToSetter.get(rootName);
            context.report({
              node: child,
              message: `In-place mutation of useState value "${rootName}" via .${methodName}() — call ${setterName} with a new array; React only re-renders on a new reference`,
            });
          }
        },
      );
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body);
      },
    };
  },
});
