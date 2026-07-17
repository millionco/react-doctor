import { HTML_TAGS } from "../../constants/html-tags.js";
import { SVG_TAGS } from "../../constants/svg-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { R3F_PUBLIC_MODULES } from "./utils/r3f-public-modules.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const POINTER_CAPTURE_METHODS = new Set([
  "hasPointerCapture",
  "releasePointerCapture",
  "setPointerCapture",
]);
const R3F_OBJECT_EVENT_FIELDS = new Set(["eventObject", "object"]);

const isR3fEventObject = (
  expression: EsTreeNode,
  eventParameter: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = context.scopes.symbolFor(candidate);
    if (
      symbol?.kind === "const" &&
      symbol.initializer &&
      !visitedSymbolIds.has(symbol.id) &&
      symbol.references.every((reference) => reference.flag === "read")
    ) {
      visitedSymbolIds.add(symbol.id);
      return isR3fEventObject(symbol.initializer, eventParameter, context, visitedSymbolIds);
    }
    return false;
  }
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    !R3F_OBJECT_EVENT_FIELDS.has(getStaticPropertyName(candidate) ?? "")
  ) {
    return false;
  }
  const receiver = stripParenExpression(candidate.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    isNodeOfType(eventParameter, "Identifier") &&
    context.scopes.symbolFor(receiver)?.id === context.scopes.symbolFor(eventParameter)?.id
  );
};

const findInvalidPointerCaptureCalls = (
  handler: EsTreeNode,
  context: RuleContext,
): EsTreeNode[] => {
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") &&
    !isNodeOfType(handler, "FunctionExpression") &&
    !isNodeOfType(handler, "FunctionDeclaration")
  ) {
    return [];
  }
  const rawEventParameter = handler.params[0];
  const eventParameter = isNodeOfType(rawEventParameter, "AssignmentPattern")
    ? rawEventParameter.left
    : rawEventParameter;
  if (!isNodeOfType(eventParameter, "Identifier")) return [];
  const invalidCalls: EsTreeNode[] = [];
  walkFunctionExecution(handler, context.scopes, (candidate) => {
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      !POINTER_CAPTURE_METHODS.has(getStaticPropertyName(candidate.callee) ?? "") ||
      !isR3fEventObject(candidate.callee.object, eventParameter, context)
    ) {
      return;
    }
    invalidCalls.push(candidate);
  });
  return invalidCalls;
};

export const r3fNoObjectPointerCapture = defineRule({
  id: "r3f-no-object-pointer-capture",
  title: "Pointer capture called on an R3F scene object",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Call pointer-capture methods on the R3F event target or currentTarget, not object or eventObject",
  create: (context: RuleContext) => {
    let hasR3fRuntimeImport = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        hasR3fRuntimeImport = node.body.some(
          (statement) =>
            isNodeOfType(statement, "ImportDeclaration") &&
            !isTypeOnlyImport(statement) &&
            typeof statement.source.value === "string" &&
            R3F_PUBLIC_MODULES.has(statement.source.value),
        );
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!hasR3fRuntimeImport) return;
        const elementType = resolveJsxElementType(node);
        if (
          !elementType ||
          elementType[0] !== elementType[0]?.toLowerCase() ||
          HTML_TAGS.has(elementType) ||
          (SVG_TAGS.has(elementType) && elementType !== "line")
        ) {
          return;
        }
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          const attributeName = getJsxAttributeName(attribute.name);
          if (
            !attributeName?.startsWith("onPointer") ||
            !attribute.value ||
            !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
            isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
          ) {
            continue;
          }
          const handler = resolveExactLocalFunction(attribute.value.expression, context.scopes);
          if (!handler) continue;
          for (const invalidCall of findInvalidPointerCaptureCalls(handler, context)) {
            context.report({
              node: invalidCall,
              message:
                "R3F scene objects do not implement DOM pointer capture. Call this method on event.target or event.currentTarget",
            });
          }
        }
      },
    };
  },
});
