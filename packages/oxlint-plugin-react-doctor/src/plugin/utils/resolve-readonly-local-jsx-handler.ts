import { LOCAL_JSX_HANDLER_STATEMENT_COUNT } from "../constants/thresholds.js";
import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { isNoOpStatement } from "./is-no-op-statement.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const resolveReadonlyLocalJsxHandler = (
  identifier: EsTreeNodeOfType<"Identifier">,
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  const openingElement = attribute.parent;
  const attributeName = getJsxAttributeName(attribute.name);
  if (
    !attributeName ||
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isNodeOfType(openingElement.name, "JSXIdentifier") ||
    !HTML_TAGS.has(openingElement.name.name) ||
    getAuthoritativeJsxAttribute(openingElement.attributes, attributeName) !== attribute
  ) {
    return null;
  }
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || symbol.kind !== "const") return null;
  const declaration = symbol.declarationNode;
  const ownerFunction = findEnclosingFunction(attribute);
  if (
    !ownerFunction ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !isNodeOfType(declaration.parent.parent, "BlockStatement") ||
    declaration.parent.parent.parent !== ownerFunction ||
    findEnclosingFunction(declaration) !== ownerFunction ||
    declaration.range[1] >= attribute.range[0] ||
    !declaration.init ||
    !symbol.references.every(
      (reference) =>
        reference.identifier === identifier &&
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier),
    )
  ) {
    return null;
  }
  const handler = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.async ||
    handler.params.length !== 0
  ) {
    return null;
  }
  if (isNodeOfType(handler.body, "BlockStatement")) {
    const statements = handler.body.body.filter(
      (statement) =>
        !isNoOpStatement(statement) ||
        (isNodeOfType(statement, "ExpressionStatement") &&
          isNodeOfType(stripParenExpression(statement.expression), "Identifier")),
    );
    const statement = statements[0];
    if (
      statements.length !== LOCAL_JSX_HANDLER_STATEMENT_COUNT ||
      (!isNodeOfType(statement, "ExpressionStatement") &&
        !(isNodeOfType(statement, "ReturnStatement") && statement.argument))
    ) {
      return null;
    }
  }
  return handler;
};
