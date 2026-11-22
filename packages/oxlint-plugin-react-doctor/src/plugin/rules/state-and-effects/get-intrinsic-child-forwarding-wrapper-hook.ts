import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getExecutableValueReferences } from "../../utils/get-executable-value-references.js";
import { getValueImportSource } from "../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const getShorthandIdentifier = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    !isNodeOfType(node, "Property") ||
    node.computed ||
    node.method ||
    !node.shorthand ||
    node.kind !== "init" ||
    !isNodeOfType(node.key, "Identifier") ||
    !isNodeOfType(node.value, "Identifier") ||
    node.key.name !== node.value.name
  ) {
    return null;
  }
  return node.value;
};

const isOnlyRead = (binding: EsTreeNode, use: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = scopes.symbolFor(binding);
  if (symbol?.bindingIdentifier !== binding) return false;
  const references = getExecutableValueReferences(symbol);
  if (references.length !== 1) return false;
  const [reference] = references;
  return reference?.identifier === use && reference.flag === "read";
};

const isStaticDefaultValue = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") &&
    (node.value === null ||
      typeof node.value === "string" ||
      typeof node.value === "number" ||
      typeof node.value === "boolean")) ||
  (isNodeOfType(node, "ArrowFunctionExpression") &&
    !node.async &&
    node.params.length === 0 &&
    isNodeOfType(node.body, "BlockStatement") &&
    node.body.body.length === 0);

const getJsxAttributeExpression = (
  attribute: EsTreeNode | undefined,
  name: "ref" | "className",
): EsTreeNodeOfType<"Identifier"> | null =>
  isNodeOfType(attribute, "JSXAttribute") &&
  isNodeOfType(attribute.name, "JSXIdentifier") &&
  attribute.name.name === name &&
  isNodeOfType(attribute.value, "JSXExpressionContainer") &&
  isNodeOfType(attribute.value.expression, "Identifier")
    ? attribute.value.expression
    : null;

// The returned call is the wrapper's only opaque runtime step. The return
// value here proves JSX child forwarding. The caller still owns the effective
// imports, the hook/ref contract, and the JSX emitter.
export const getIntrinsicChildForwardingWrapperHook = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    !isNodeOfType(node, "ArrowFunctionExpression") ||
    node.async ||
    node.params.length !== 1 ||
    !isNodeOfType(node.body, "BlockStatement") ||
    node.body.body.length !== 3
  ) {
    return null;
  }

  const [props] = node.params;
  const [extractProps, extractRef, ret] = node.body.body;
  if (
    !isNodeOfType(props, "Identifier") ||
    !isNodeOfType(extractProps, "VariableDeclaration") ||
    extractProps.kind !== "const" ||
    extractProps.declarations.length !== 1 ||
    !isNodeOfType(extractRef, "VariableDeclaration") ||
    extractRef.kind !== "const" ||
    extractRef.declarations.length !== 1 ||
    !isNodeOfType(ret, "ReturnStatement") ||
    !ret.argument
  ) {
    return null;
  }

  const [destructured] = extractProps.declarations;
  const [refDeclaration] = extractRef.declarations;
  const element = stripParenExpression(ret.argument);
  if (
    !isNodeOfType(destructured?.id, "ObjectPattern") ||
    !isNodeOfType(destructured.init, "ObjectExpression") ||
    destructured.init.properties.length !== 2 ||
    !isNodeOfType(refDeclaration?.id, "ObjectPattern") ||
    refDeclaration.id.properties.length !== 1 ||
    !isNodeOfType(refDeclaration.init, "CallExpression") ||
    refDeclaration.init.optional ||
    !isNodeOfType(refDeclaration.init.callee, "Identifier") ||
    refDeclaration.init.arguments.length !== 1 ||
    !isNodeOfType(element, "JSXElement")
  ) {
    return null;
  }

  const [spreadDefaults, spreadProps] = destructured.init.properties;
  if (
    !isNodeOfType(spreadDefaults, "SpreadElement") ||
    !isNodeOfType(spreadDefaults.argument, "Identifier") ||
    !isNodeOfType(spreadProps, "SpreadElement") ||
    !isNodeOfType(spreadProps.argument, "Identifier") ||
    !isOnlyRead(props, spreadProps.argument, scopes)
  ) {
    return null;
  }

  const defaults = scopes.symbolFor(spreadDefaults.argument);
  if (
    defaults?.scope !== scopes.rootScope ||
    defaults.kind !== "const" ||
    !isNodeOfType(defaults.declarationNode, "VariableDeclarator") ||
    defaults.declarationNode.id !== defaults.bindingIdentifier ||
    !isNodeOfType(defaults.declarationNode.parent, "VariableDeclaration") ||
    !isNodeOfType(defaults.declarationNode.parent.parent, "Program") ||
    !isNodeOfType(defaults.declarationNode.init, "ObjectExpression") ||
    !isOnlyRead(defaults.bindingIdentifier, spreadDefaults.argument, scopes)
  ) {
    return null;
  }
  for (const field of defaults.declarationNode.init.properties) {
    if (
      !isNodeOfType(field, "Property") ||
      field.kind !== "init" ||
      field.computed ||
      field.method ||
      field.shorthand ||
      !isNodeOfType(field.key, "Identifier") ||
      field.key.name === "children" ||
      field.key.name === "__proto__" ||
      !isStaticDefaultValue(field.value)
    ) {
      return null;
    }
  }

  const propsByName = new Map<string, EsTreeNode>();
  for (const property of destructured.id.properties) {
    const binding = getShorthandIdentifier(property);
    if (!binding || propsByName.has(binding.name)) return null;
    propsByName.set(binding.name, binding);
  }

  const forwardedChild = propsByName.get("children");
  const className = propsByName.get("className");
  const [refProperty] = refDeclaration.id.properties;
  const ref = refProperty && getShorthandIdentifier(refProperty);
  const { attributes, name } = element.openingElement;
  if (
    !forwardedChild ||
    !className ||
    ref?.name !== "ref" ||
    !isNodeOfType(name, "JSXIdentifier") ||
    name.name !== "div" ||
    attributes.length !== 2
  ) {
    return null;
  }

  const refUse = getJsxAttributeExpression(attributes[0], "ref");
  const classUse = getJsxAttributeExpression(attributes[1], "className");
  const children = element.children.filter(
    (child) => !isNodeOfType(child, "JSXText") || child.value.trim() !== "",
  );
  const [child] = children;
  if (
    !refUse ||
    !classUse ||
    !isOnlyRead(ref, refUse, scopes) ||
    !isOnlyRead(className, classUse, scopes) ||
    children.length !== 1 ||
    !isNodeOfType(child, "JSXExpressionContainer") ||
    !isNodeOfType(child.expression, "Identifier") ||
    !isOnlyRead(forwardedChild, child.expression, scopes)
  ) {
    return null;
  }

  const hook = refDeclaration.init;
  const hookBinding = scopes.symbolFor(refDeclaration.init.callee);
  const [hookArgs] = hook.arguments;
  if (
    hookBinding?.kind !== "import" ||
    !getValueImportSource(hookBinding) ||
    !isNodeOfType(hookArgs, "ObjectExpression") ||
    hookArgs.properties.length !== propsByName.size - 2
  ) {
    return null;
  }

  const seenHookProps = new Set<string>();
  for (const property of hookArgs.properties) {
    const use = getShorthandIdentifier(property);
    if (
      !use ||
      use.name === "children" ||
      use.name === "className" ||
      seenHookProps.has(use.name)
    ) {
      return null;
    }
    const binding = propsByName.get(use.name);
    if (!binding || !isOnlyRead(binding, use, scopes)) return null;
    seenHookProps.add(use.name);
  }
  return hook;
};
