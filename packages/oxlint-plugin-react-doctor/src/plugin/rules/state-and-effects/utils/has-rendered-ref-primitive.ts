import { isRefNotificationNativeElement } from "./is-ref-notification-native-element.js";
import { isClosedRefNotificationRenderHelper } from "./is-closed-ref-notification-render-helper.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { collectRenderReachableExpressions } from "./collect-render-reachable-expressions.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isDescendantWithoutFunctionBoundary } from "../../../utils/is-descendant-without-function-boundary.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { readConstantBoolean } from "../../../utils/read-constant-boolean.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface RenderedRefPrimitiveOptions {
  read: EsTreeNodeOfType<"MemberExpression">;
  value: EsTreeNodeOfType<"Literal">;
  componentBody: EsTreeNode;
  program: EsTreeNode;
  context: RuleContext;
}

const readNativeBranchText = (
  node: EsTreeNode,
  requireCompleteText: boolean,
  context: RuleContext,
): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "JSXText")) return expression.value;
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "string" || typeof expression.value === "number")
      return String(expression.value);
    return expression.value === null || typeof expression.value === "boolean" ? "" : null;
  }
  if (isNodeOfType(expression, "JSXExpressionContainer")) {
    const child = stripParenExpression(expression.expression);
    if (!requireCompleteText && !isNodeOfType(child, "Literal")) return "";
    return readNativeBranchText(child, requireCompleteText, context);
  }
  if (isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment")) {
    if (
      isNodeOfType(expression, "JSXElement") &&
      !isRefNotificationNativeElement(expression, context.scopes, true)
    )
      return null;
    const children = expression.children.map((child) =>
      readNativeBranchText(child, requireCompleteText, context),
    );
    if (children.some((child) => child === null)) return null;
    if (!requireCompleteText) return children.find((child) => child?.trim()) ?? "";
    return children.join(" ");
  }
  return null;
};

export const hasRenderedRefPrimitive = ({
  read,
  value,
  componentBody,
  program,
  context,
}: RenderedRefPrimitiveOptions): boolean => {
  const componentFunction = findEnclosingFunction(componentBody);
  const expressions = collectRenderReachableExpressions(componentBody);
  const isRenderOwner = (node: EsTreeNode): boolean => {
    const owner = findEnclosingFunction(node);
    if (owner === componentFunction) return true;
    return Boolean(
      componentFunction &&
      isClosedRefNotificationRenderHelper({
        helper: owner,
        component: componentFunction,
        program,
        context,
        isRenderedCall: (call) =>
          expressions.some((expression) => isDescendantWithoutFunctionBoundary(call, expression)) &&
          isNativeRenderedPosition(call),
      }),
    );
  };
  const occursInRenderedExpression = (node: EsTreeNode): boolean => {
    const owner = findEnclosingFunction(node);
    if (!isFunctionLike(owner) || !isRenderOwner(node)) return false;
    const roots = isNodeOfType(owner.body, "BlockStatement")
      ? collectRenderReachableExpressions(owner.body)
      : [owner.body];
    return roots.some((expression) => isDescendantWithoutFunctionBoundary(node, expression));
  };
  const isNativeRenderedPosition = (
    node: EsTreeNode,
    certifiedPredicate: EsTreeNode | null = null,
  ): boolean => {
    if (!occursInRenderedExpression(node)) return false;
    let cursor: EsTreeNode | null | undefined = node;
    while (cursor && !isFunctionLike(cursor)) {
      if (
        isNodeOfType(cursor, "JSXElement") &&
        !isRefNotificationNativeElement(cursor, context.scopes, true)
      )
        return false;
      const expressionRoot = findTransparentExpressionRoot(cursor);
      const parent: EsTreeNode | null | undefined = expressionRoot.parent;
      if (!parent || isFunctionLike(parent)) break;
      if (isNodeOfType(parent, "ConditionalExpression")) {
        const knownTest = readConstantBoolean(parent.test, context.scopes);
        if (parent !== certifiedPredicate && dependsOnSelectedRef(parent.test)) return false;
        if (
          parent.test === expressionRoot ||
          (parent.consequent === expressionRoot && knownTest === false) ||
          (parent.alternate === expressionRoot && knownTest === true)
        )
          return false;
      } else if (isNodeOfType(parent, "LogicalExpression")) {
        const knownLeft = readConstantBoolean(parent.left, context.scopes);
        if (parent !== certifiedPredicate && dependsOnSelectedRef(parent.left)) return false;
        if (
          parent.right !== expressionRoot ||
          parent.operator === "??" ||
          (parent.operator === "&&" && knownLeft === false) ||
          (parent.operator === "||" && knownLeft === true)
        )
          return false;
      } else if (isNodeOfType(parent, "IfStatement")) {
        const knownTest = readConstantBoolean(parent.test, context.scopes);
        if (parent !== certifiedPredicate && dependsOnSelectedRef(parent.test)) return false;
        if (
          parent.test === expressionRoot ||
          (parent.consequent === expressionRoot && knownTest === false) ||
          (parent.alternate === expressionRoot && knownTest === true)
        )
          return false;
      } else if (
        !isNodeOfType(parent, "JSXExpressionContainer") &&
        !isNodeOfType(parent, "JSXElement") &&
        !isNodeOfType(parent, "JSXFragment") &&
        !isNodeOfType(parent, "ReturnStatement") &&
        !isNodeOfType(parent, "BlockStatement")
      ) {
        return false;
      }
      cursor = parent;
    }
    return true;
  };
  const selectedRef = context.scopes.symbolFor(stripParenExpression(read.object));
  const dependsOnSelectedRef = (node: EsTreeNode, visitedSymbols = new Set<number>()): boolean => {
    let hasSelectedRead = false;
    walkAst(node, (child) => {
      if (!isNodeOfType(child, "Identifier")) return;
      const symbol = context.scopes.symbolFor(child);
      if (!symbol) return;
      if (symbol === selectedRef) hasSelectedRead = true;
      if (!visitedSymbols.has(symbol.id)) {
        visitedSymbols.add(symbol.id);
        const initializer = getDirectConstInitializer(symbol);
        if (initializer && dependsOnSelectedRef(initializer, visitedSymbols))
          hasSelectedRead = true;
      }
    });
    return hasSelectedRead;
  };
  const visitedAliases = new Set<number>();
  const reachesDisplay = (node: EsTreeNode, isPredicate: boolean): boolean => {
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (!parent) return false;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === root &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const symbol = context.scopes.symbolFor(parent.id);
      if (
        !symbol ||
        getDirectConstInitializer(symbol) !== root ||
        visitedAliases.has(symbol.id) ||
        !hasCompleteSymbolReferences(symbol, program, context.scopes)
      )
        return false;
      visitedAliases.add(symbol.id);
      return (
        symbol.references.every(
          (reference) =>
            reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
        ) &&
        symbol.references.some((reference) => reachesDisplay(reference.identifier, isPredicate))
      );
    }
    if (
      isNodeOfType(parent, "BinaryExpression") &&
      !isPredicate &&
      (parent.operator === "===" || parent.operator === "!==")
    ) {
      const other = stripParenExpression(parent.left === root ? parent.right : parent.left);
      return (
        isNodeOfType(other, "Literal") &&
        Object.is(other.value, value.value) &&
        reachesDisplay(parent, true)
      );
    }
    if (isNodeOfType(parent, "LogicalExpression") && isPredicate) {
      const sibling = parent.left === root ? parent.right : parent.left;
      if (dependsOnSelectedRef(sibling)) return false;
      const leftValue = readConstantBoolean(parent.left, context.scopes);
      const rightValue = readConstantBoolean(parent.right, context.scopes);
      if (parent.operator !== "&&" && parent.operator !== "||") return false;
      if (
        parent.left === root &&
        ((parent.operator === "&&" && rightValue === false) ||
          (parent.operator === "||" && rightValue === true))
      )
        return false;
      if (
        parent.right === root &&
        ((parent.operator === "&&" && leftValue === false) ||
          (parent.operator === "||" && leftValue === true))
      )
        return false;
      if (
        parent.left === root &&
        parent.operator === "&&" &&
        (isNodeOfType(stripParenExpression(parent.right), "JSXElement") ||
          isNodeOfType(stripParenExpression(parent.right), "JSXFragment"))
      ) {
        const branchText = readNativeBranchText(parent.right, false, context)?.replace(/\s+/g, "");
        return Boolean(branchText && isNativeRenderedPosition(parent));
      }
      return reachesDisplay(parent, true);
    }
    if (isNodeOfType(parent, "UnaryExpression") && isPredicate && parent.operator === "!")
      return reachesDisplay(parent, true);
    if (isNodeOfType(parent, "ConditionalExpression")) {
      const knownTest = readConstantBoolean(parent.test, context.scopes);
      if (parent.test === root) {
        const consequent = stripParenExpression(parent.consequent);
        const alternate = stripParenExpression(parent.alternate);
        const hasConsequentJsx =
          isNodeOfType(consequent, "JSXElement") || isNodeOfType(consequent, "JSXFragment");
        const hasAlternateJsx =
          isNodeOfType(alternate, "JSXElement") || isNodeOfType(alternate, "JSXFragment");
        const selectedBranch = hasConsequentJsx ? consequent : alternate;
        const otherBranch = hasConsequentJsx ? alternate : consequent;
        const selectedText = readNativeBranchText(selectedBranch, false, context)?.replace(
          /\s+/g,
          "",
        );
        const otherText = readNativeBranchText(otherBranch, true, context)?.replace(/\s+/g, "");
        return Boolean(
          isPredicate &&
          isNativeRenderedPosition(parent) &&
          hasConsequentJsx !== hasAlternateJsx &&
          selectedText &&
          otherText !== undefined &&
          !otherText.includes(selectedText),
        );
      }
      if (!isPredicate && dependsOnSelectedRef(parent.test)) return false;
      if (
        (knownTest === true && parent.alternate === root) ||
        (knownTest === false && parent.consequent === root)
      )
        return false;
      const other = stripParenExpression(
        parent.consequent === root ? parent.alternate : parent.consequent,
      );
      return isNodeOfType(other, "Literal") && reachesDisplay(parent, isPredicate);
    }
    if (isNodeOfType(parent, "IfStatement") && parent.test === root && isPredicate) {
      const renderOwner = findEnclosingFunction(parent);
      if (!isFunctionLike(renderOwner) || !isRenderOwner(parent)) return false;
      const returnValues = collectRenderReachableExpressions(renderOwner.body).filter(
        (expression) =>
          isNodeOfType(expression.parent, "ReturnStatement") &&
          expression.parent.argument === expression,
      );
      if (
        returnValues.some(
          (expression) =>
            !isNodeOfType(expression, "JSXElement") &&
            !isNodeOfType(expression, "JSXFragment") &&
            !isNodeOfType(expression, "Literal"),
        )
      )
        return false;
      return [parent.consequent, parent.alternate].some((branch) => {
        let roots: EsTreeNode[] = [];
        if (isNodeOfType(branch, "ReturnStatement") && branch.argument) {
          roots = [branch.argument];
        } else if (isNodeOfType(branch, "BlockStatement")) {
          roots = collectRenderReachableExpressions(branch);
        }
        return roots.some((expression) => {
          if (!isNodeOfType(expression, "JSXElement") && !isNodeOfType(expression, "JSXFragment"))
            return false;
          const selectedText = readNativeBranchText(expression, false, context)?.replace(
            /\s+/g,
            "",
          );
          return (
            selectedText &&
            isNativeRenderedPosition(expression, parent) &&
            returnValues.every((other) => {
              if (other === expression) return true;
              const otherText = readNativeBranchText(other, true, context)?.replace(/\s+/g, "");
              return otherText !== undefined && !otherText.includes(selectedText);
            })
          );
        });
      });
    }
    if (
      !isNodeOfType(parent, "JSXExpressionContainer") ||
      parent.expression !== root ||
      !isNativeRenderedPosition(parent)
    )
      return false;
    const containerOwner = parent.parent;
    return (
      !isPredicate &&
      (typeof value.value === "string" || typeof value.value === "number") &&
      (isNodeOfType(containerOwner, "JSXElement") || isNodeOfType(containerOwner, "JSXFragment"))
    );
  };
  return reachesDisplay(read, false);
};
