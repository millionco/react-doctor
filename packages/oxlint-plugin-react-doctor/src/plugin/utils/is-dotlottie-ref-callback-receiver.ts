import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";

const CALLBACK_PROP = "dotLottieRefCallback";
const INSTANCE_METHODS = new Set([
  "addEventListener",
  "removeEventListener",
  "pause",
  "play",
  "setFrame",
  "setSegment",
]);

const isClosed = (binding: SymbolDescriptor, program: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isSymbolReadOnly(binding) && hasCompleteSymbolReferences(binding, program, scopes);

const isDirectReactHook = (node: EsTreeNode, hook: string, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isReactApiCall(node, hook, scopes, { resolveNamedAliases: true });

const isDirectInstanceUse = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const parent = identifier.parent;
  if (isNodeOfType(parent, "IfStatement")) return parent.test === identifier;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") {
    const conditional = parent.parent;
    return isNodeOfType(conditional, "IfStatement") && conditional.test === parent;
  }
  if (isNodeOfType(parent, "ArrayExpression")) {
    const hook = parent.parent;
    return (
      isNodeOfType(hook, "CallExpression") &&
      ["useEffect", "useImperativeHandle"].some(
        (name) =>
          hook.arguments[name === "useEffect" ? 1 : 2] === parent &&
          isDirectReactHook(hook, name, scopes),
      )
    );
  }
  if (!isNodeOfType(parent, "MemberExpression") || parent.object !== identifier || parent.computed)
    return false;
  const name = getStaticPropertyName(parent);
  const call = parent.parent;
  return (
    name !== null &&
    INSTANCE_METHODS.has(name) &&
    isNodeOfType(call, "CallExpression") &&
    call.callee === parent
  );
};

/** Proves the state value originates exclusively from the declared component's callback. */
export const isDotLottieRefCallbackReceiver = (
  receiver: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const program = findProgramRoot(receiver);
  const binding = scopes.symbolFor(receiver);
  const tuple = binding?.declarationNode;
  if (
    !program ||
    !binding ||
    binding.kind !== "const" ||
    !isClosed(binding, program, scopes) ||
    !binding.references.every(({ identifier }) => isDirectInstanceUse(identifier, scopes)) ||
    !isNodeOfType(tuple, "VariableDeclarator") ||
    !isNodeOfType(tuple.id, "ArrayPattern") ||
    tuple.id.elements.length !== 2 ||
    tuple.id.elements[0] !== binding.bindingIdentifier ||
    !isNodeOfType(tuple.init, "CallExpression") ||
    !isDirectReactHook(tuple.init, "useState", scopes)
  )
    return false;
  const owner = findEnclosingFunction(tuple);
  const stopped = tuple.init.arguments[0];
  const setterIdentifier = tuple.id.elements[1];
  if (
    !owner ||
    tuple.init.arguments.length !== 1 ||
    !isNodeOfType(stopped, "Literal") ||
    stopped.value !== null ||
    !isNodeOfType(setterIdentifier, "Identifier")
  )
    return false;
  const setter = scopes.symbolFor(setterIdentifier);
  if (!setter || !isClosed(setter, program, scopes) || setter.references.length !== 1) return false;
  const setterRead = setter.references[0]?.identifier;
  const write = setterRead?.parent;
  if (
    !isNodeOfType(write, "CallExpression") ||
    write.optional ||
    write.callee !== setterRead ||
    write.arguments.length !== 1
  )
    return false;
  const body = isNodeOfType(write.parent, "ExpressionStatement") ? write.parent.parent : null;
  const callback = body?.parent ?? write.parent;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    !isNodeOfType(write.arguments[0], "Identifier") ||
    scopes.symbolFor(write.arguments[0]) !== scopes.symbolFor(callback.params[0])
  )
    return false;
  if (
    callback.body !== write &&
    (!isNodeOfType(body, "BlockStatement") || callback.body !== body || body.body.length !== 1)
  )
    return false;

  const memo = callback.parent;
  if (
    !isNodeOfType(memo, "CallExpression") ||
    !isDirectReactHook(memo, "useCallback", scopes) ||
    memo.arguments.length !== 2 ||
    memo.arguments[0] !== callback ||
    !isNodeOfType(memo.arguments[1], "ArrayExpression") ||
    memo.arguments[1].elements.length !== 0 ||
    findEnclosingFunction(memo) !== owner
  )
    return false;
  const callbackDefinition = memo.parent;
  if (
    !isNodeOfType(callbackDefinition, "VariableDeclarator") ||
    !isNodeOfType(callbackDefinition.id, "Identifier")
  )
    return false;
  const exportBinding = scopes.symbolFor(callbackDefinition.id);
  if (
    !exportBinding ||
    exportBinding.kind !== "const" ||
    !isClosed(exportBinding, program, scopes) ||
    exportBinding.references.length !== 1
  )
    return false;
  const jsxValue = exportBinding.references[0]?.identifier.parent;
  const attribute = jsxValue?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(jsxValue, "JSXExpressionContainer") ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !opening.selfClosing ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    getAuthoritativeJsxAttribute(opening.attributes, CALLBACK_PROP) !== attribute ||
    findEnclosingFunction(opening) !== owner
  )
    return false;
  const element = opening.parent;
  if (
    !isNodeOfType(element, "JSXElement") ||
    !isNodeOfType(element.parent, "ReturnStatement") ||
    element.parent.argument !== element
  )
    return false;
  const component = scopes.symbolFor(opening.name);
  const imported =
    component?.bindingIdentifier &&
    resolveImportedApiReference(component.bindingIdentifier, scopes);
  return Boolean(
    component &&
    component.kind === "import" &&
    isClosed(component, program, scopes) &&
    component.references.length === 1 &&
    component.references[0]?.identifier === opening.name &&
    imported?.source === "@lottiefiles/dotlottie-react" &&
    imported.importedName === "DotLottieReact",
  );
};
