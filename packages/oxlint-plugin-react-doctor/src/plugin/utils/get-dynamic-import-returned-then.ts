import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ReturnedExportCall {
  readonly specifier: string;
  readonly exportedName: string;
  readonly binding: EsTreeNodeOfType<"Identifier">;
  readonly callee: EsTreeNodeOfType<"Identifier">;
}

interface DynamicImportReturnedThen {
  readonly importer: EsTreeNode;
  readonly returned: EsTreeNode;
  readonly setter: EsTreeNodeOfType<"Identifier">;
  readonly exportedCall: ReturnedExportCall | null;
}

export const getDynamicImportReturnedThen = (
  node: EsTreeNode,
): DynamicImportReturnedThen | null => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return null;
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getStaticPropertyName(callee) !== "then"
  ) {
    return null;
  }
  const importer = stripParenExpression(callee.object);
  const argument = node.arguments[0];
  if (!isNodeOfType(importer, "ImportExpression") || !argument) return null;
  const callback = stripParenExpression(argument);
  if (!isFunctionLike(callback) || callback.generator || callback.params.length > 1) return null;
  const parameter = callback.params[0];
  if (
    parameter &&
    !isNodeOfType(parameter, "Identifier") &&
    (!isNodeOfType(parameter, "ObjectPattern") ||
      parameter.properties.some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          !isNodeOfType(property.value, "Identifier") ||
          getStaticPropertyKeyName(property, { allowComputedString: true }) === null,
      ))
  ) {
    return null;
  }
  const returnedExpression = getSingleReturnExpression(callback);
  if (!returnedExpression) return null;
  const returned = stripParenExpression(returnedExpression);
  let chain = returned;
  while (isNodeOfType(chain, "CallExpression") && !chain.optional) {
    const method = stripParenExpression(chain.callee);
    if (!isNodeOfType(method, "MemberExpression") || method.optional) return null;
    const name = getStaticPropertyName(method);
    const receiver = stripParenExpression(method.object);
    if (name === "catch" || name === "finally") {
      chain = receiver;
      continue;
    }
    if (name !== "then" || !chain.arguments[0]) return null;
    const setter = stripParenExpression(chain.arguments[0]);
    if (!isNodeOfType(setter, "Identifier")) return null;
    const specifier = stripParenExpression(importer.source);
    if (
      isNodeOfType(receiver, "CallExpression") &&
      !receiver.optional &&
      isNodeOfType(specifier, "Literal") &&
      typeof specifier.value === "string" &&
      isNodeOfType(parameter, "ObjectPattern")
    ) {
      const provider = stripParenExpression(receiver.callee);
      if (isNodeOfType(provider, "Identifier")) {
        const bindingProperty = parameter.properties.find(
          (property) =>
            isNodeOfType(property, "Property") &&
            isNodeOfType(property.value, "Identifier") &&
            property.value.name === provider.name,
        );
        if (
          isNodeOfType(bindingProperty, "Property") &&
          isNodeOfType(bindingProperty.value, "Identifier")
        ) {
          const exportedName = getStaticPropertyKeyName(bindingProperty, {
            allowComputedString: true,
          });
          if (exportedName) {
            return {
              importer,
              returned,
              setter,
              exportedCall: {
                specifier: specifier.value,
                exportedName,
                binding: bindingProperty.value,
                callee: provider,
              },
            };
          }
        }
      }
    }
    return { importer, returned, setter, exportedCall: null };
  }
  return null;
};
