import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isPropertyNamePosition } from "./is-property-name-position.js";
import { hasOnlyErasedTypeNameBindings } from "./has-only-erased-type-name-bindings.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface NamedWindowMessageDataRead {
  readonly body: EsTreeNode;
  readonly read: EsTreeNode;
  readonly isLocalBinding: boolean;
}

const WINDOW_PROVIDER_ROOTS = new Set(["window", "Window", "EventTarget", "globalThis", "self"]);
const UNSUPPORTED_REFLECTION_METHODS = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "set",
  "deleteProperty",
  "get",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
]);
const WINDOW_PROVIDER_OBJECT_PROPERTIES = new Set([
  "window",
  "self",
  "parent",
  "top",
  "frames",
  "defaultView",
  "Window",
  "EventTarget",
  "prototype",
]);
const providerEligibility = new WeakMap<EsTreeNode, boolean>();

const isRuntimeIdentifier = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (node.type !== "Identifier") return false;
  if (scopes.referenceFor(node)) return true;
  if (scopes.symbolFor(node)?.bindingIdentifier === node) return false;
  const parent = node.parent;
  if (
    isPropertyNamePosition(node) &&
    !(
      parent?.type === "Property" &&
      parent.value === node &&
      parent.parent?.type === "ObjectExpression"
    )
  )
    return false;
  if (parent?.type === "LabeledStatement" && parent.label === node) return false;
  if (
    (parent?.type === "BreakStatement" || parent?.type === "ContinueStatement") &&
    parent.label === node
  )
    return false;
  if (
    (parent?.type === "MethodDefinition" ||
      parent?.type === "PropertyDefinition" ||
      parent?.type === "AccessorProperty") &&
    parent.key === node &&
    !parent.computed
  )
    return false;
  if (
    parent?.type === "ImportSpecifier" ||
    parent?.type === "ImportDefaultSpecifier" ||
    parent?.type === "ImportNamespaceSpecifier"
  )
    return false;
  if (parent?.type === "ExportSpecifier" && parent.exported === node && parent.local !== node)
    return false;
  return true;
};

const hasClosedWindowMessageProvider = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = providerEligibility.get(program);
  if (cached !== undefined) return cached;
  let eligible = true;
  walkAst(program, (node) => {
    if (!eligible) return false;
    if (
      node.type === "WithStatement" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSExportAssignment" ||
      node.type === "TSParameterProperty" ||
      (node.type === "Identifier" && node.name === "arguments")
    ) {
      eligible = false;
      return false;
    }
    if (
      node.type === "TSTypeAliasDeclaration" ||
      node.type === "TSInterfaceDeclaration" ||
      isTypeScriptTypePosition(node)
    )
      return false;
    if (
      node.type === "Identifier" &&
      (node.name === "Function" || node.name === "eval") &&
      isRuntimeIdentifier(node, scopes)
    )
      eligible = false;
    if (node.type === "MemberExpression") {
      const propertyName = getStaticPropertyName(node);
      const receiver = stripParenExpression(node.object);
      if (
        propertyName === "constructor" ||
        propertyName === "__defineGetter__" ||
        propertyName === "__defineSetter__"
      )
        eligible = false;
      if (
        receiver.type === "Identifier" &&
        (receiver.name === "Object" || receiver.name === "Reflect") &&
        (propertyName === null || UNSUPPORTED_REFLECTION_METHODS.has(propertyName))
      )
        eligible = false;
    }
    if (node.type === "Property" && node.parent?.type === "ObjectPattern") {
      const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (
        propertyName === null ||
        propertyName === "constructor" ||
        propertyName === "__defineGetter__" ||
        propertyName === "__defineSetter__" ||
        UNSUPPORTED_REFLECTION_METHODS.has(propertyName)
      )
        eligible = false;
    }
    if (node.type === "Identifier" || node.type === "MemberExpression") {
      let receiver = stripParenExpression(node);
      const propertyNames: (string | null)[] = [];
      while (receiver.type === "MemberExpression") {
        propertyNames.unshift(getStaticPropertyName(receiver));
        receiver = stripParenExpression(receiver.object);
      }
      if (
        receiver.type === "Identifier" &&
        WINDOW_PROVIDER_ROOTS.has(receiver.name) &&
        isRuntimeIdentifier(receiver, scopes)
      ) {
        if (
          propertyNames.some(
            (propertyName) =>
              propertyName === "Function" || propertyName === "eval" || propertyName === null,
          )
        )
          eligible = false;
        const isProviderObject =
          propertyNames.length === 0 ||
          propertyNames.some((propertyName) => propertyName === null) ||
          WINDOW_PROVIDER_OBJECT_PROPERTIES.has(propertyNames.at(-1) ?? "");
        if (isProviderObject) {
          const root = findTransparentExpressionRoot(node);
          const parent = root.parent;
          const isMemberReceiver = parent?.type === "MemberExpression" && parent.object === root;
          const isNativeConstructor =
            parent?.type === "NewExpression" &&
            parent.callee === root &&
            propertyNames.length === 0 &&
            scopes.isGlobalReference(receiver) &&
            (receiver.name === "Window" || receiver.name === "EventTarget");
          if (!isMemberReceiver && !isNativeConstructor) eligible = false;
        }
      }
    }
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const callee = stripParenExpression(node.callee);
      if (callee.type === "Identifier" && (callee.name === "eval" || callee.name === "Function")) {
        eligible = false;
      }
    }
    let assignmentTarget: EsTreeNode | null = null;
    if (
      node.type === "AssignmentExpression" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    ) {
      assignmentTarget = node.left;
    } else if (
      node.type === "UpdateExpression" ||
      (node.type === "UnaryExpression" && node.operator === "delete")
    ) {
      assignmentTarget = node.argument;
    }
    if (assignmentTarget !== null) {
      walkAst(assignmentTarget, (candidate) => {
        if (candidate.type === "Identifier" && WINDOW_PROVIDER_ROOTS.has(candidate.name))
          eligible = false;
      });
    }
  });
  providerEligibility.set(program, eligible);
  return eligible;
};

const isDirectPayloadAcquisition = (read: EsTreeNode, body: EsTreeNode): boolean => {
  let current = read;
  while (true) {
    if (
      isFunctionLike(current) ||
      current.type === "ClassExpression" ||
      current.type === "ClassDeclaration" ||
      current.type === "ConditionalExpression" ||
      current.type === "LogicalExpression" ||
      current.type === "ChainExpression" ||
      current.type === "AssignmentPattern" ||
      (current.type === "AssignmentExpression" && current.operator !== "=") ||
      ((current.type === "CallExpression" || current.type === "MemberExpression") &&
        current.optional)
    )
      return false;
    if (current === body) return true;
    if (current.parent === body && body.type === "BlockStatement") {
      const firstStatement = body.body.find(
        (statement) =>
          statement.type !== "ExpressionStatement" || typeof statement.directive !== "string",
      );
      return (
        current === firstStatement &&
        (current.type === "ExpressionStatement" || current.type === "VariableDeclaration")
      );
    }
    const parent = current.parent;
    if (!parent) return false;
    current = parent;
  }
};

export const getNamedWindowMessageDataRead = (
  registration: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): NamedWindowMessageDataRead | null => {
  if (
    registration.type !== "CallExpression" ||
    registration.optional ||
    !hasClosedWindowMessageProvider(program, scopes)
  )
    return null;
  const callee = stripParenExpression(registration.callee);
  if (
    callee.type !== "MemberExpression" ||
    callee.optional ||
    getStaticPropertyName(callee) !== "addEventListener"
  )
    return null;
  const receiver = stripParenExpression(callee.object);
  const receiverSymbol = scopes.symbolFor(receiver);
  const eventName = registration.arguments[0];
  const callbackReference = registration.arguments[1];
  if (
    receiver.type !== "Identifier" ||
    receiver.name !== "window" ||
    hasVisibleAmbientFunctionDeclaration(scopes.scopeFor(receiver), "window") ||
    !(
      scopes.isGlobalReference(receiver) ||
      (receiverSymbol && hasOnlyErasedTypeNameBindings(receiverSymbol))
    ) ||
    eventName?.type !== "Literal" ||
    eventName.value !== "message" ||
    callbackReference?.type !== "Identifier" ||
    hasVisibleAmbientFunctionDeclaration(scopes.scopeFor(callbackReference), callbackReference.name)
  )
    return null;
  const callbackSymbol = scopes.symbolFor(callbackReference);
  if (
    !callbackSymbol ||
    (callbackSymbol.kind !== "const" && callbackSymbol.kind !== "function") ||
    !callbackSymbol.references.every((reference) => reference.flag === "read") ||
    callbackSymbol.scope.symbols.some(
      (symbol) =>
        symbol !== callbackSymbol &&
        symbol.name === callbackSymbol.name &&
        !isErasedTypeScriptBinding(symbol),
    )
  )
    return null;
  if (
    callbackSymbol.kind === "const" &&
    (callbackSymbol.declarationNode.type !== "VariableDeclarator" ||
      callbackSymbol.declarationNode.id !== callbackSymbol.bindingIdentifier ||
      getNodeEndIndex(callbackSymbol.declarationNode) > getNodeStartIndex(registration))
  )
    return null;
  const callback = callbackSymbol.initializer && stripParenExpression(callbackSymbol.initializer);
  if (
    !callback ||
    !isFunctionLike(callback) ||
    callback.async ||
    (callback.type !== "ArrowFunctionExpression" && callback.generator) ||
    callback.params.some((parameter) => parameter.type !== "Identifier")
  )
    return null;
  const eventParameter = callback.params[0];
  if (eventParameter?.type !== "Identifier") return null;
  const eventSymbol = scopes.symbolFor(eventParameter);
  if (!eventSymbol || !eventSymbol.references.every((reference) => reference.flag === "read"))
    return null;
  if (callback.type !== "ArrowFunctionExpression" && callback.id) {
    const innerSymbol = scopes.symbolFor(callback.id);
    if (innerSymbol && !innerSymbol.references.every((reference) => reference.flag === "read"))
      return null;
  }
  let hasUncertainIdentity = false;
  walkAst(program, (node) => {
    if (
      node.type === "TSTypeAliasDeclaration" ||
      node.type === "TSInterfaceDeclaration" ||
      isTypeScriptTypePosition(node)
    )
      return false;
    if (
      node.type !== "Identifier" ||
      node.name !== callbackSymbol.name ||
      !isRuntimeIdentifier(node, scopes)
    )
      return;
    const reference = scopes.referenceFor(node);
    if (
      reference &&
      reference.resolvedSymbol !== callbackSymbol &&
      reference.resolvedSymbol?.declarationNode !== callback
    )
      return;
    if (!reference || reference.flag !== "read") hasUncertainIdentity = true;
  });
  walkAst(callback, (node) => {
    if (
      node.type === "TSTypeAliasDeclaration" ||
      node.type === "TSInterfaceDeclaration" ||
      isTypeScriptTypePosition(node)
    )
      return false;
    if (
      node.type !== "Identifier" ||
      node.name !== eventParameter.name ||
      !isRuntimeIdentifier(node, scopes)
    )
      return;
    const reference = scopes.referenceFor(node);
    if (!reference || reference.resolvedSymbol !== eventSymbol || reference.flag !== "read") {
      hasUncertainIdentity = true;
      return;
    }
    const root = findTransparentExpressionRoot(node);
    if (
      root.parent?.type === "MemberExpression" &&
      root.parent.object === root &&
      isWithinAssignmentTarget(root.parent)
    )
      hasUncertainIdentity = true;
  });
  if (hasUncertainIdentity) return null;
  const acquisitions: NamedWindowMessageDataRead[] = [];
  walkAst(callback.body, (node) => {
    if (
      node !== callback.body &&
      (isFunctionLike(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression")
    )
      return false;
    if (
      node.type === "TSTypeAliasDeclaration" ||
      node.type === "TSInterfaceDeclaration" ||
      isTypeScriptTypePosition(node)
    )
      return false;
    if (node.type === "MemberExpression" && getStaticPropertyName(node) === "data") {
      const object = stripParenExpression(node.object);
      if (object.type !== "Identifier" || scopes.symbolFor(object) !== eventSymbol) return;
      if (isWithinAssignmentTarget(node)) return;
      if (
        node.optional ||
        !isDirectPayloadAcquisition(node, callback.body) ||
        acquisitions.length > 0
      )
        return;
      acquisitions.push({ body: callback.body, read: node, isLocalBinding: false });
    }
    if (
      node.type === "VariableDeclarator" &&
      node.parent?.type === "VariableDeclaration" &&
      node.parent.kind === "const" &&
      node.id.type === "ObjectPattern" &&
      node.init &&
      isDirectPayloadAcquisition(node, callback.body)
    ) {
      const initializer = stripParenExpression(node.init);
      if (
        initializer.type === "Identifier" &&
        scopes.symbolFor(initializer) === eventSymbol &&
        node.id.properties.every(
          (property) =>
            property.type === "Property" &&
            !property.computed &&
            property.value.type === "Identifier",
        ) &&
        node.id.properties.some(
          (property) =>
            property.type === "Property" &&
            !property.computed &&
            property.key.type === "Identifier" &&
            property.key.name === "data",
        ) &&
        acquisitions.length === 0
      ) {
        acquisitions.push({ body: callback.body, read: initializer, isLocalBinding: true });
      }
    }
  });
  const acquisition = acquisitions[0];
  if (!acquisition) return null;
  for (const reference of eventSymbol.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const parent = root.parent;
    if (parent?.type === "MemberExpression" && parent.object === root) {
      if (isWithinAssignmentTarget(parent)) return null;
      continue;
    }
    if (getNodeStartIndex(reference.identifier) < getNodeStartIndex(acquisition.read)) {
      if (
        parent?.type !== "VariableDeclarator" ||
        parent.init !== root ||
        parent.id.type !== "ObjectPattern"
      )
        return null;
    }
  }
  return acquisition;
};
