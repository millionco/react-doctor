import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { BoundNode } from "./project-named-vite-omitted-boolean.js";
import {
  bindingUses,
  lexical,
  matchValue,
  onlyValueUses,
  ownProperty,
  patternRest,
} from "./project-named-vite-omitted-boolean.js";
import type { RegisteredBooleanForwarding } from "./qualify-registered-boolean-forwarding.js";
import { isStockCall } from "./qualify-registered-boolean-forwarding.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { isClosedReactContextGetterFactory } from "./resolve-owned-react-context.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";

// Selected JSX elements contain nested props before React calls their component.
// Require every observed use of the entire child value to stay in render envelopes.
export const hasClosedRegistryChildCarriers = (
  project: NamedViteSourceProject,
  forwarding: RegisteredBooleanForwarding,
): boolean => {
  const states = new Map<EsTreeNode, boolean>();
  const modulesByProgram = new Map(
    [...project.modulesByFilePath.values()].map((module) => [module.programNode, module]),
  );
  const checkedContexts = new Map<EsTreeNode, boolean>();
  const closedContext = (context: BoundNode): boolean => {
    const prior = checkedContexts.get(context.node);
    if (prior !== undefined) return prior;
    const valid = onlyValueUses(project, context, (use) => {
      const program = findProgramRoot(use);
      const useModule = program && modulesByProgram.get(program);
      const parent = use.parent;
      if (
        isNodeOfType(parent, "JSXMemberExpression") &&
        parent.object === use &&
        parent.property.name === "Provider"
      ) {
        const tag = parent.parent;
        return (
          (isNodeOfType(tag, "JSXOpeningElement") || isNodeOfType(tag, "JSXClosingElement")) &&
          tag.name === parent
        );
      }
      if (!useModule || !isNodeOfType(parent, "CallExpression") || parent.optional) return false;
      if (
        isStockCall(useModule, parent, "useContext") &&
        parent.arguments.length === 1 &&
        parent.arguments[0] === use
      )
        return true;
      return (
        parent.arguments.length === 3 &&
        parent.arguments[2] === use &&
        isClosedReactContextGetterFactory(matchValue(project, useModule, parent.callee))
      );
    });
    checkedContexts.set(context.node, valid);
    return valid;
  };
  const closedComponent = (component: BoundNode, wrapper: boolean): boolean => {
    if (
      wrapper &&
      !onlyValueUses(
        project,
        component,
        (use) =>
          (isNodeOfType(use.parent, "JSXOpeningElement") ||
            isNodeOfType(use.parent, "JSXClosingElement")) &&
          use.parent.name === use,
      )
    )
      return false;
    if (states.has(component.node)) return states.get(component.node) === true;
    states.set(component.node, false);
    const view =
      isStockCall(component.module, component.node, "forwardRef") &&
      component.node.arguments.length === 1
        ? component.node.arguments[0]
        : component.node;
    if (!isFunctionLike(view) || view.async || view.generator || view.params.length > 2)
      return false;
    const [props] = view.params;
    if (props && !isNodeOfType(props, "ObjectPattern")) return false;
    const child = isNodeOfType(props, "ObjectPattern") ? ownProperty(props, "children") : null;
    const symbol =
      child && isNodeOfType(child.value, "Identifier")
        ? lexical(component.module, child.value)
        : null;
    if (
      (child && !symbol) ||
      (isNodeOfType(props, "ObjectPattern") && !symbol && patternRest(props)) ||
      symbol?.references.some((reference) => reference.flag !== "read")
    )
      return false;
    for (const use of symbol ? bindingUses(symbol) : []) {
      if (!closedRoute(component.module, use, view)) return false;
    }
    states.set(component.node, true);
    return true;
  };
  const closedElement = (module: NamedViteSourceModule, element: EsTreeNode): boolean => {
    if (isNodeOfType(element, "JSXFragment")) return true;
    if (!isNodeOfType(element, "JSXElement")) return false;
    const name = element.openingElement.name;
    if (isNodeOfType(name, "JSXIdentifier")) {
      if (/^[a-z][a-z0-9]*$/u.test(name.name)) return true;
      const wrapper = matchValue(project, module, name);
      return Boolean(wrapper && closedComponent(wrapper, true));
    }
    if (!isNodeOfType(name, "JSXMemberExpression") || name.property.name !== "Provider")
      return false;
    const context = matchValue(project, module, name.object);
    // The selected props context gets a separate complete reader census.
    if (!context || !isStockCall(context.module, context.node, "createContext")) return false;
    return closedContext(context);
  };
  const closedRoute = (
    module: NamedViteSourceModule,
    input: EsTreeNode,
    owner: EsTreeNode,
  ): boolean => {
    let current = findTransparentExpressionRoot(input);
    for (let hop = 0; hop < 18; hop++) {
      const parent = current.parent;
      if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) {
        return findEnclosingFunction(parent) === owner;
      }
      if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === current)
        return parent === owner;
      if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) {
        const element = parent.parent;
        if (!isNodeOfType(element, "JSXElement") && !isNodeOfType(element, "JSXFragment"))
          return false;
        if (
          !element.children.some((child) => child === (parent as EsTreeNode)) ||
          !closedElement(module, element)
        )
          return false;
        current = element;
      } else if (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) {
        if (!parent.children.some((child) => child === current) || !closedElement(module, parent))
          return false;
        current = parent;
      } else if (
        (isNodeOfType(parent, "ConditionalExpression") &&
          (parent.consequent === current || parent.alternate === current)) ||
        (isNodeOfType(parent, "LogicalExpression") &&
          parent.operator === "&&" &&
          parent.right === current)
      ) {
        current = parent;
      } else if (
        isNodeOfType(parent, "CallExpression") &&
        !parent.optional &&
        parent.arguments.length === 2 &&
        parent.arguments[0] === current
      ) {
        const imported = resolveImportedApiReference(parent.callee, module.scopes);
        if (imported?.source !== "react-dom" || imported.importedName !== "createPortal")
          return false;
        current = parent;
      } else return false;
      current = findTransparentExpressionRoot(current);
    }
    return false;
  };
  const rendered = forwarding.renderExpression;
  const owner = findEnclosingFunction(rendered.node);
  if (!owner || !closedRoute(rendered.module, rendered.node, owner)) return false;
  return forwarding.graphComponents.every((component) => closedComponent(component, false));
};
