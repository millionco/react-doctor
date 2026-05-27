import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

type FunctionLikeNode =
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression">;

const getFunctionDisplayName = (node: FunctionLikeNode): string | null => {
  if (
    (isNodeOfType(node, "FunctionDeclaration") || isNodeOfType(node, "FunctionExpression")) &&
    node.id
  ) {
    return node.id.name;
  }
  const parent = node.parent;
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id.name;
  }
  return null;
};

const isComponentName = (name: string | null): boolean => {
  if (!name) return false;
  const firstCharacter = name.charAt(0);
  return (
    firstCharacter.toUpperCase() === firstCharacter &&
    firstCharacter !== firstCharacter.toLowerCase()
  );
};

const findLastNonDeclarationStatement = (
  body: ReadonlyArray<EsTreeNode>,
): EsTreeNode | undefined => {
  for (let cursor = body.length - 1; cursor >= 0; cursor--) {
    const candidate = body[cursor];
    if (!candidate.type.endsWith("Declaration")) return candidate;
  }
  return undefined;
};

const collectEarlyReturnStatements = (
  body: ReadonlyArray<EsTreeNode>,
  lastReturn: EsTreeNode | null,
): ReadonlyArray<EsTreeNodeOfType<"ReturnStatement">> => {
  const collected: EsTreeNodeOfType<"ReturnStatement">[] = [];
  const walk = (node: EsTreeNode): void => {
    if (isNodeOfType(node, "ReturnStatement") && node !== lastReturn) {
      collected.push(node);
      return;
    }
    if (isNodeOfType(node, "FunctionDeclaration")) return;
    if (isNodeOfType(node, "FunctionExpression")) return;
    if (isNodeOfType(node, "ArrowFunctionExpression")) return;
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) walk(item as EsTreeNode);
        }
      } else if (child && typeof child === "object" && "type" in child) {
        walk(child as EsTreeNode);
      }
    }
  };
  for (const statement of body) walk(statement);
  return collected;
};

const isHocCallParent = (node: FunctionLikeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (!parent.arguments.some((argument) => argument === node)) return false;
  if (isNodeOfType(parent.callee, "Identifier")) {
    return !isComponentName(parent.callee.name);
  }
  return false;
};

const isRenderPropCallback = (node: FunctionLikeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  return isNodeOfType(parent, "JSXExpressionContainer");
};

// Port of `solid/components-return-once` — Solid components run
// ONCE. Early returns and conditional returns at the top-level
// break reactivity because the unmount path is taken before any
// reactive read fires. The rule warns on every early return inside
// a function that renders JSX, and on any conditional / `&&`
// expression that escapes via the last `return` statement.
export const solidComponentsReturnOnce = defineRule<Rule>({
  id: "solid-components-return-once",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Inline conditional rendering inside JSX (`<Show>` / `<Switch>`) instead of returning early — Solid components only run once.",
  create: (context: RuleContext) => {
    const visitFunction = (node: FunctionLikeNode): void => {
      if (!containsJsxElement(node as EsTreeNode)) return;
      if (isRenderPropCallback(node)) return;
      const displayName = getFunctionDisplayName(node);
      if (displayName && /^[a-z]/.test(displayName)) return;
      if (isHocCallParent(node)) return;

      if (
        node.body &&
        !isNodeOfType(node.body, "BlockStatement") &&
        isNodeOfType(node, "ArrowFunctionExpression")
      ) {
        const expressionBody = node.body as EsTreeNode;
        if (isNodeOfType(expressionBody, "ConditionalExpression")) {
          context.report({
            node: expressionBody,
            message:
              "Solid components run once, so a conditional return breaks reactivity. Move the condition inside JSX (`<Show>`).",
          });
        } else if (
          isNodeOfType(expressionBody, "LogicalExpression") &&
          (expressionBody.operator === "&&" || expressionBody.operator === "||")
        ) {
          context.report({
            node: expressionBody,
            message:
              "Solid components run once, so a conditional return breaks reactivity. Move the condition inside JSX (`<Show>`).",
          });
        }
        return;
      }

      let lastReturn: EsTreeNodeOfType<"ReturnStatement"> | null = null;
      let bodyStatements: ReadonlyArray<EsTreeNode> = [];
      if (node.body && isNodeOfType(node.body, "BlockStatement")) {
        bodyStatements = node.body.body;
        const lastNonDeclaration = findLastNonDeclarationStatement(bodyStatements);
        if (lastNonDeclaration && isNodeOfType(lastNonDeclaration, "ReturnStatement")) {
          lastReturn = lastNonDeclaration;
        }
      }

      const earlyReturns = collectEarlyReturnStatements(bodyStatements, lastReturn);
      for (const earlyReturn of earlyReturns) {
        context.report({
          node: earlyReturn,
          message:
            "Solid components run once, so an early return breaks reactivity. Move the condition inside JSX (`<Show>`).",
        });
      }

      const returnArgument = lastReturn?.argument;
      if (!returnArgument) return;
      if (isNodeOfType(returnArgument, "ConditionalExpression")) {
        context.report({
          node: returnArgument,
          message:
            "Solid components run once, so a conditional return breaks reactivity. Move the condition inside JSX (`<Show>`).",
        });
      } else if (
        isNodeOfType(returnArgument, "LogicalExpression") &&
        (returnArgument.operator === "&&" || returnArgument.operator === "||")
      ) {
        context.report({
          node: returnArgument,
          message:
            "Solid components run once, so a conditional return breaks reactivity. Move the condition inside JSX (`<Show>`).",
        });
      }
    };
    return {
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
