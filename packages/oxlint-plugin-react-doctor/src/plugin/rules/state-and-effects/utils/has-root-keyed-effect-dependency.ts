import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const MOUNT_EFFECT_HOOKS = new Set([...EFFECT_HOOK_NAMES, "useInsertionEffect"]);
const RESERVED_PROPS = new Set(["key", "ref", "__self", "__source"]);

const directEvalByProgram = new WeakMap<EsTreeNode, boolean>();

const hasDirectEval = (program: EsTreeNode): boolean => {
  const cached = directEvalByProgram.get(program);
  if (cached !== undefined) return cached;
  const result = someAst(program, (node) => {
    if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
    const callee = stripParenExpression(node.callee);
    return isNodeOfType(callee, "Identifier") && callee.name === "eval";
  });
  directEvalByProgram.set(program, result);
  return result;
};

const isNamedImport = (
  expression: EsTreeNode,
  source: string,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  const identifier = stripParenExpression(expression);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return false;
  const imported = resolveImportedApiReference(identifier, scopes);
  return imported?.source === source && imported.importedName === name;
};

const isCreateRoot = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNamedImport(node.callee, "react-dom/client", "createRoot", scopes);

const isRootMethod = (receiver: EsTreeNode, method: string): boolean => {
  const receiverRoot = findTransparentExpressionRoot(receiver);
  const member = receiverRoot.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiverRoot ||
    member.optional ||
    getStaticPropertyName(member) !== method
  ) {
    return false;
  }
  const memberRoot = findTransparentExpressionRoot(member);
  const call = memberRoot.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === memberRoot && !call.optional;
};

const isOwnedRootRender = (
  element: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const elementRoot = findTransparentExpressionRoot(element);
  const call = elementRoot.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== elementRoot
  ) {
    return false;
  }
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isRootMethod(receiver, "render")) return false;
  if (isCreateRoot(receiver, scopes)) return true;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const root = scopes.symbolFor(receiver);
  if (!root || !isSymbolReadOnly(root)) return false;
  const initializer = getDirectConstInitializer(root);
  if (!initializer || !isCreateRoot(stripParenExpression(initializer), scopes)) return false;
  const declaration = root.declarationNode.parent;
  if (
    !isNodeOfType(declaration?.parent, "Program") &&
    !isNodeOfType(declaration?.parent, "BlockStatement")
  ) {
    return false;
  }
  return (
    hasCompleteSymbolReferences(root, program, scopes) &&
    root.references.every(
      ({ identifier }) => isRootMethod(identifier, "render") || isRootMethod(identifier, "unmount"),
    )
  );
};

const isSharedString = (key: EsTreeNode, prop: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const keyValue = stripParenExpression(key);
  const propValue = stripParenExpression(prop);
  if (!isNodeOfType(keyValue, "Identifier") || !isNodeOfType(propValue, "Identifier")) return false;
  const symbol = scopes.symbolFor(keyValue);
  if (!symbol || scopes.symbolFor(propValue) !== symbol || !isSymbolReadOnly(symbol)) return false;
  const init = getDirectConstInitializer(symbol);
  if (!init) return false;
  const value = stripParenExpression(init);
  return (
    (isNodeOfType(value, "Literal") && typeof value.value === "string") ||
    isNodeOfType(value, "TemplateLiteral") ||
    (isNodeOfType(value, "CallExpression") &&
      !value.optional &&
      isNodeOfType(stripParenExpression(value.callee), "Identifier") &&
      isProvenUnmodifiedGlobalNamespaceReference(value.callee, "String", scopes, undefined, true))
  );
};

const isMatchingRootElement = (
  componentReference: EsTreeNode,
  propName: string,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const referenceRoot = findTransparentExpressionRoot(componentReference);
  const element = referenceRoot.parent;
  if (
    !isNodeOfType(element, "CallExpression") ||
    element.optional ||
    element.arguments.length !== 2 ||
    element.arguments[0] !== referenceRoot ||
    !isNamedImport(element.callee, "react", "createElement", scopes)
  ) {
    return false;
  }

  const props = stripParenExpression(element.arguments[1]);
  if (!isNodeOfType(props, "ObjectExpression")) return false;
  if (
    !props.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.computed &&
        getStaticPropertyKeyName(property) !== "__proto__",
    )
  )
    return false;
  const key = getStaticObjectPropertyValue(props, "key");
  const trackedProp = getStaticObjectPropertyValue(props, propName);
  return Boolean(
    key &&
    trackedProp &&
    isSharedString(key, trackedProp, scopes) &&
    isOwnedRootRender(element, program, scopes),
  );
};

export const hasRootKeyedEffectDependency = (
  effect: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const dependencies = effect.arguments[1];
  if (!isNodeOfType(dependencies, "ArrayExpression") || dependencies.elements.length !== 1) {
    return false;
  }
  const dependency = dependencies.elements[0];
  if (!isNodeOfType(dependency, "Identifier")) return false;
  const component = findEnclosingFunction(effect);
  if (!component || !isFunctionLike(component)) return false;
  const parameter = component.params[0];
  const prop = scopes.symbolFor(dependency);
  if (
    !isNodeOfType(parameter, "ObjectPattern") ||
    !prop ||
    !isSymbolReadOnly(prop) ||
    prop.bindingIdentifier.parent?.parent !== parameter
  ) {
    return false;
  }
  const propName = getDestructuredBindingPropertyName(prop.bindingIdentifier);
  if (!propName || RESERVED_PROPS.has(propName)) return false;
  if (isNodeOfType(component, "FunctionExpression") && component.id) return false;
  const hook = stripParenExpression(effect.callee);
  if (![...EFFECT_HOOK_NAMES].some((name) => isNamedImport(hook, "react", name, scopes)))
    return false;
  const [owner] = getFunctionBindingSymbols(component, scopes);
  if (!owner || !isSymbolReadOnly(owner) || owner.references.length === 0) return false;
  const declaration = isNodeOfType(component, "FunctionDeclaration")
    ? component
    : owner.declarationNode.parent;
  const program = declaration?.parent;
  if (!isNodeOfType(program, "Program")) return false;
  if (
    !isNodeOfType(component, "FunctionDeclaration") &&
    getDirectConstInitializer(owner) !== findTransparentExpressionRoot(component)
  ) {
    return false;
  }
  // The same primitive string reaches reconciliation and the dependency. The
  // owner can only receive a different value through a fresh keyed mount.
  return (
    hasCompleteSymbolReferences(owner, program, scopes) &&
    owner.references.every(({ identifier }) =>
      isMatchingRootElement(identifier, propName, program, scopes),
    ) &&
    !hasDirectEval(program) &&
    !someAst(
      component.body,
      (node) =>
        node !== effect &&
        isNodeOfType(node, "CallExpression") &&
        isReactHookCall(node, MOUNT_EFFECT_HOOKS, scopes),
    )
  );
};
