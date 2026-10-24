import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isLiteralVoidExpression } from "../../../utils/is-literal-void-expression.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT } from "./constants.js";

export interface DeferredIframePassiveCaptureContext {
  readonly module: SourceProjectModule;
  readonly getReadonlySymbol: (identifier: EsTreeNode) => SymbolDescriptor | null;
  readonly getReadonlyInitializer: (identifier: EsTreeNode) => EsTreeNode | null;
}

export const hasPassiveDeferredIframeCapture = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: DeferredIframePassiveCaptureContext,
): boolean => {
  if (opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
    return false;
  const attribute = getAuthoritativeJsxAttribute(opening.attributes, "onClickCapture");
  if (!attribute) return true;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  let handler = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(handler, "Literal") && (handler.value === null || handler.value === false))
    return true;
  const visitedIdentifiers = new Set<EsTreeNode>();
  while (isNodeOfType(handler, "Identifier")) {
    if (visitedIdentifiers.has(handler)) return false;
    visitedIdentifiers.add(handler);
    const initializer = context.getReadonlyInitializer(handler);
    if (!initializer) return false;
    handler = stripParenExpression(initializer);
  }
  if (
    !isFunctionLike(handler) ||
    handler.async ||
    ("generator" in handler && handler.generator) ||
    handler.params.length > DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT
  )
    return false;
  const [eventParameter] = handler.params;
  if (eventParameter && !isNodeOfType(eventParameter, "Identifier")) return false;
  const eventSymbol = eventParameter ? context.getReadonlySymbol(eventParameter) : null;
  if (eventParameter && !eventSymbol) return false;
  const isEventReceiver = (node: EsTreeNode): boolean =>
    Boolean(
      eventSymbol &&
      isNodeOfType(node, "Identifier") &&
      context.module.scopes.symbolFor(node) === eventSymbol,
    );
  const isPassiveArgument = (node: EsTreeNode): boolean => {
    const argument = stripParenExpression(node);
    if (isNodeOfType(argument, "Literal"))
      return (
        argument.value === null ||
        ["string", "number", "boolean", "bigint"].includes(typeof argument.value)
      );
    if (isNodeOfType(argument, "Identifier"))
      return argument.name === "undefined" && context.module.scopes.isGlobalReference(argument);
    return (
      isNodeOfType(argument, "MemberExpression") &&
      !argument.computed &&
      !argument.optional &&
      getStaticPropertyName(argument) === "type" &&
      isEventReceiver(argument.object)
    );
  };
  const isPassiveExpression = (node: EsTreeNode): boolean => {
    const expression = stripParenExpression(node);
    if (isPassiveArgument(expression) || isLiteralVoidExpression(expression)) return true;
    if (!isNodeOfType(expression, "CallExpression") || expression.optional) return false;
    const callee = expression.callee;
    if (!isNodeOfType(callee, "MemberExpression") || callee.computed || callee.optional)
      return false;
    const methodName = getStaticPropertyName(callee);
    if (
      methodName === "preventDefault" &&
      isEventReceiver(callee.object) &&
      !expression.arguments.length
    )
      return true;
    return (
      methodName === "log" &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "console" &&
      context.module.scopes.isGlobalReference(callee.object) &&
      expression.arguments.every(isPassiveArgument)
    );
  };
  const body = stripParenExpression(handler.body);
  if (!isNodeOfType(body, "BlockStatement")) return isPassiveExpression(body);
  return body.body.every((statement) => {
    if (isNodeOfType(statement, "EmptyStatement")) return true;
    if (isNodeOfType(statement, "ExpressionStatement"))
      return isPassiveExpression(statement.expression);
    return (
      isNodeOfType(statement, "ReturnStatement") &&
      (!statement.argument || isPassiveExpression(statement.argument))
    );
  });
};
