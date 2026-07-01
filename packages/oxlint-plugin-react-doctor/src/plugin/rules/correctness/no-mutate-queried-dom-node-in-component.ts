import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const DOM_QUERY_METHODS = new Set(["getElementById", "querySelector", "querySelectorAll"]);
const CLASS_LIST_MUTATION_METHODS = new Set(["add", "remove", "toggle", "replace"]);
// App-shell / third-party roots are never a component's own reconciled subtree.
const EXCLUDED_QUERY_TOKENS = new Set(["root", "__next"]);

interface OwnedTokens {
  ids: Set<string>;
  classNames: Set<string>;
  testIds: Set<string>;
}

interface QueryTarget {
  kind: "id" | "class" | "testid";
  value: string;
}

const literalStringFromJsxAttributeValue = (
  value: EsTreeNode | null | undefined,
): string | null => {
  if (!value) return null;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") return value.value;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return expression.value;
    }
  }
  return null;
};

// Collects the literal id / className / data-testid tokens the file's JSX
// renders. The ownership link — a queried selector must match one of these —
// is what proves a mutated node is React-owned by this file, suppressing the
// portal / third-party / non-React node false positives.
const collectOwnedTokens = (programRoot: EsTreeNode): OwnedTokens => {
  const owned: OwnedTokens = {
    ids: new Set(),
    classNames: new Set(),
    testIds: new Set(),
  };
  walkAst(programRoot, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "JSXAttribute")) return;
    const attributeName = getJsxAttributeName(node.name);
    if (!attributeName) return;
    const value = literalStringFromJsxAttributeValue(node.value);
    if (value === null) return;
    if (attributeName === "id") {
      owned.ids.add(value);
    } else if (attributeName === "className" || attributeName === "class") {
      for (const className of value.split(/\s+/)) {
        if (className) owned.classNames.add(className);
      }
    } else if (attributeName === "data-testid") {
      owned.testIds.add(value);
    }
  });
  return owned;
};

const parseSelectorTarget = (selector: string): QueryTarget | null => {
  const idMatch = /^#([\w-]+)$/.exec(selector);
  if (idMatch) return { kind: "id", value: idMatch[1] };
  const classMatch = /^\.([\w-]+)$/.exec(selector);
  if (classMatch) return { kind: "class", value: classMatch[1] };
  const testIdMatch = /^\[data-testid=["']([^"']+)["']\]$/.exec(selector);
  if (testIdMatch) return { kind: "testid", value: testIdMatch[1] };
  return null;
};

// The static id / selector a `document.getElementById/querySelector(All)(...)`
// call targets, or null when the argument isn't a static string or the callee
// isn't a literal `document` query.
const queryCallTarget = (node: EsTreeNode): QueryTarget | null => {
  const stripped = stripParenExpression(node);
  if (!isNodeOfType(stripped, "CallExpression")) return null;
  const callee = stripped.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "document") return null;
  if (
    !isNodeOfType(callee.property, "Identifier") ||
    !DOM_QUERY_METHODS.has(callee.property.name)
  ) {
    return null;
  }
  const argument = stripped.arguments?.[0];
  if (!isNodeOfType(argument, "Literal") || typeof argument.value !== "string") return null;
  if (callee.property.name === "getElementById") return { kind: "id", value: argument.value };
  return parseSelectorTarget(argument.value);
};

const isOwnedQueryTarget = (target: QueryTarget | null, owned: OwnedTokens): boolean => {
  if (!target || EXCLUDED_QUERY_TOKENS.has(target.value)) return false;
  if (target.kind === "id") return owned.ids.has(target.value);
  if (target.kind === "class") return owned.classNames.has(target.value);
  return owned.testIds.has(target.value);
};

// `X.style.<prop>` / `X.style.cssText` → the mutated node `X`, else null.
const styleAssignmentReceiver = (assignmentTarget: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(assignmentTarget, "MemberExpression")) return null;
  const object = assignmentTarget.object;
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "style"
  ) {
    return object.object;
  }
  return null;
};

// `X.classList.add|remove|toggle|replace(...)` → the mutated node `X`, else null.
const classListMutationReceiver = (callee: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  if (!CLASS_LIST_MUTATION_METHODS.has(callee.property.name)) return null;
  const object = callee.object;
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "classList"
  ) {
    return object.object;
  }
  return null;
};

export const noMutateQueriedDomNodeInComponent = defineRule({
  id: "no-mutate-queried-dom-node-in-component",
  title: "Mutating a queried DOM node this component renders",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Drive the node with state/props (or a ref for genuinely uncontrolled nodes) instead of querying it and mutating its style/class. Imperative edits to a node React renders are invisible to the virtual DOM and get reverted or clobbered on the next render.",
  create: (context: RuleContext) => {
    let ownedTokens: OwnedTokens | null = null;
    const reported = new WeakSet<EsTreeNode>();

    const receiverIsOwnedQuery = (
      receiver: EsTreeNode,
      ownedQueryVariables: Set<string>,
      owned: OwnedTokens,
    ): boolean => {
      const stripped = stripParenExpression(receiver);
      if (isNodeOfType(stripped, "Identifier")) return ownedQueryVariables.has(stripped.name);
      if (isNodeOfType(stripped, "CallExpression")) {
        return isOwnedQueryTarget(queryCallTarget(stripped), owned);
      }
      return false;
    };

    const analyzeComponent = (functionNode: EsTreeNode, owned: OwnedTokens): void => {
      const ownedQueryVariables = new Set<string>();
      walkAst(functionNode, (node: EsTreeNode) => {
        if (!isNodeOfType(node, "VariableDeclarator")) return;
        if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
        if (isOwnedQueryTarget(queryCallTarget(node.init), owned)) {
          ownedQueryVariables.add(node.id.name);
        }
      });

      walkAst(functionNode, (node: EsTreeNode) => {
        if (isNodeOfType(node, "AssignmentExpression")) {
          const receiver = styleAssignmentReceiver(node.left);
          if (receiver && receiverIsOwnedQuery(receiver, ownedQueryVariables, owned)) {
            if (reported.has(node)) return;
            reported.add(node);
            context.report({
              node,
              message:
                "You mutate the style of a DOM node this component renders, so React reverts your change on the next render; drive it with state/props or a ref instead.",
            });
          }
          return;
        }
        if (isNodeOfType(node, "CallExpression")) {
          const receiver = classListMutationReceiver(node.callee);
          if (receiver && receiverIsOwnedQuery(receiver, ownedQueryVariables, owned)) {
            if (reported.has(node)) return;
            reported.add(node);
            context.report({
              node,
              message:
                "You mutate the classList of a DOM node this component renders, so React reverts your change on the next render; drive it with state/props or a ref instead.",
            });
          }
        }
      });
    };

    const visitFunction = (functionNode: EsTreeNode): void => {
      if (!ownedTokens) return;
      if (!componentOrHookDisplayNameForFunction(functionNode)) return;
      analyzeComponent(functionNode, ownedTokens);
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        ownedTokens = collectOwnedTokens(node);
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        visitFunction(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        visitFunction(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        visitFunction(node);
      },
    };
  },
});
