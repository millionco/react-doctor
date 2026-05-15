import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isHookCall } from "../../../utils/is-hook-call.js";
import { isSetterIdentifier } from "../../../utils/is-setter-identifier.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const collectUseStateBindings = (
  componentBody: EsTreeNode,
): Array<{
  valueName: string;
  setterName: string;
  declarator: EsTreeNodeOfType<"VariableDeclarator">;
}> => {
  const bindings: Array<{
    valueName: string;
    setterName: string;
    declarator: EsTreeNodeOfType<"VariableDeclarator">;
  }> = [];
  if (!isNodeOfType(componentBody, "BlockStatement")) return bindings;

  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
      const elements = declarator.id.elements ?? [];
      if (elements.length < 2) continue;
      const valueElement = elements[0];
      const setterElement = elements[1];
      if (
        !isNodeOfType(valueElement, "Identifier") ||
        !isNodeOfType(setterElement, "Identifier") ||
        !isSetterIdentifier(setterElement.name)
      ) {
        continue;
      }
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;
      if (!isHookCall(declarator.init, "useState")) continue;
      bindings.push({
        valueName: valueElement.name,
        setterName: setterElement.name,
        declarator,
      });
    }
  }
  return bindings;
};
