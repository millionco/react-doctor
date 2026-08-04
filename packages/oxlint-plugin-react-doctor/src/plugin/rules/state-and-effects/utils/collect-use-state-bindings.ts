import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { isSetterIdentifier } from "../../../utils/is-setter-identifier.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export interface UseStateBinding {
  readonly valueName: string;
  readonly setterName: string;
  readonly declarator: EsTreeNodeOfType<"VariableDeclarator">;
}

const useStateBindingsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, ReadonlyArray<UseStateBinding>>
>();

export const collectUseStateBindings = (
  componentBody: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<UseStateBinding> => {
  let bindingsByComponent = useStateBindingsByScopes.get(scopes);
  if (!bindingsByComponent) {
    bindingsByComponent = new WeakMap();
    useStateBindingsByScopes.set(scopes, bindingsByComponent);
  }
  const cachedBindings = bindingsByComponent.get(componentBody);
  if (cachedBindings) return cachedBindings;

  const bindings: UseStateBinding[] = [];
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
      if (!isReactHookCall(declarator.init, "useState", scopes)) continue;
      bindings.push({
        valueName: valueElement.name,
        setterName: setterElement.name,
        declarator,
      });
    }
  }
  bindingsByComponent.set(componentBody, bindings);
  return bindings;
};
