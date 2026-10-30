import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getRootIdentifier } from "../../../utils/get-root-identifier.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isErasedTypeScriptNamespace } from "../../../utils/is-erased-typescript-namespace.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isValueRenderedInSameRender } from "../../react-builtins/is-value-rendered-in-same-render.js";
import {
  FIRST_ARGUMENT_INDEX,
  SECOND_ARGUMENT_INDEX,
  NATIVE_MEDIA_CALL_ARGUMENT_COUNT,
  NATIVE_MEDIA_EFFECT_PARAMETER_COUNT,
  NATIVE_MEDIA_ELEMENT_NAMES,
  NATIVE_MEDIA_PROVIDER_NAMES,
  NATIVE_MEDIA_REF_GLOBAL_NAMES,
  NATIVE_MEDIA_REF_REACT_APIS,
  NATIVE_MEDIA_REF_EVENT_NAMES,
  NATIVE_MEDIA_REF_LISTENER_ARGUMENT_COUNT,
  NATIVE_MEDIA_REF_PROTOTYPE_KEYS,
} from "./effect/constants.js";

interface ClosedNativeMediaRefSnapshotInput {
  expression: EsTreeNode;
  effectFunction: EsTreeNode;
  context: RuleContext;
}

const readonlyNativeMediaBindings = new WeakMap<SymbolDescriptor, boolean>();
const closedNativeMediaPrograms = new WeakMap<ScopeAnalysis, boolean>();
const nativeMediaReactApiProofs = new WeakMap<
  ScopeAnalysis,
  WeakMap<SymbolDescriptor, Map<string, boolean>>
>();
const nativeMediaSnapshotProofs = new WeakMap<
  ScopeAnalysis,
  WeakMap<SymbolDescriptor, WeakMap<EsTreeNode, boolean>>
>();

const isReadonlyNativeMediaBinding = (symbol: SymbolDescriptor): boolean => {
  const cached = readonlyNativeMediaBindings.get(symbol);
  if (cached !== undefined) return cached;
  const readonly =
    symbol.kind === "const" &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
    );
  readonlyNativeMediaBindings.set(symbol, readonly);
  return readonly;
};

const isClosedNativeMediaReactApiCall = (
  call: EsTreeNode,
  api: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(call, "CallExpression") || !isReactApiCall(call, api, context.scopes))
    return false;
  const identifier = getRootIdentifier(stripParenExpression(call.callee));
  const symbol = identifier ? context.scopes.symbolFor(identifier) : null;
  if (symbol?.kind !== "import") return false;
  let bindings = nativeMediaReactApiProofs.get(context.scopes);
  if (!bindings) {
    bindings = new WeakMap();
    nativeMediaReactApiProofs.set(context.scopes, bindings);
  }
  let proofs = bindings.get(symbol);
  if (!proofs) {
    proofs = new Map();
    bindings.set(symbol, proofs);
  }
  const cached = proofs.get(api);
  if (cached !== undefined) return cached;
  const closed = isProvenUnmodifiedReactApiCall(call, api, context.scopes);
  proofs.set(api, closed);
  return closed;
};

const hasClosedNativeMediaRefProgram = (context: RuleContext): boolean => {
  const cached = closedNativeMediaPrograms.get(context.scopes);
  if (cached !== undefined) return cached;
  if (hasReactDefaultProviderMutation("useRef", context.scopes)) {
    closedNativeMediaPrograms.set(context.scopes, false);
    return false;
  }
  let hasProgramHazard = false;
  walkAst(context.scopes.rootScope.node, (candidate) => {
    if (hasProgramHazard) return false;
    if (
      ("declare" in candidate && candidate.declare === true) ||
      isNodeOfType(candidate, "WithStatement") ||
      isNodeOfType(candidate, "ImportExpression") ||
      isNodeOfType(candidate, "ThisExpression") ||
      isNodeOfType(candidate, "Super") ||
      isNodeOfType(candidate, "TSEnumDeclaration") ||
      isNodeOfType(candidate, "TSImportEqualsDeclaration") ||
      isNodeOfType(candidate, "TSExportAssignment") ||
      isNodeOfType(candidate, "TSParameterProperty") ||
      (isNodeOfType(candidate, "TSModuleDeclaration") && !isErasedTypeScriptNamespace(candidate))
    ) {
      hasProgramHazard = true;
      return false;
    }
    if (isTypeScriptTypePosition(candidate)) return false;
    if (isNodeOfType(candidate, "Identifier") && context.scopes.referenceFor(candidate)) {
      const binding = context.scopes.symbolFor(candidate);
      if (
        (binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding)) ||
        candidate.name === "arguments" ||
        [...NATIVE_MEDIA_REF_GLOBAL_NAMES, ...NATIVE_MEDIA_PROVIDER_NAMES].some((name) =>
          isProvenGlobalNamespaceReference(candidate, name, context.scopes),
        ) ||
        isProvenGlobalObjectReference(candidate, context.scopes)
      ) {
        hasProgramHazard = true;
        return false;
      }
    }
    if (
      isNodeOfType(candidate, "MemberExpression") ||
      (isNodeOfType(candidate, "Property") && isNodeOfType(candidate.parent, "ObjectPattern"))
    ) {
      const property = getResolvedStaticPropertyName(candidate, context.scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        (candidate.computed && property === null) ||
        (property !== null && NATIVE_MEDIA_REF_PROTOTYPE_KEYS.has(property)) ||
        (isNodeOfType(candidate, "MemberExpression") && isMemberMutationTarget(candidate))
      )
        hasProgramHazard = true;
    }
  });
  if (hasProgramHazard) {
    closedNativeMediaPrograms.set(context.scopes, false);
    return false;
  }
  for (const symbol of context.scopes.rootScope.symbols) {
    const imported = getImportDeclarationForSymbol(symbol);
    if (
      imported?.source.value !== "react" ||
      imported.importKind === "type" ||
      (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind === "type")
    )
      continue;
    if (
      !symbol.references.every((reference) => {
        const identifier = reference.identifier;
        if (isTypeScriptTypePosition(identifier)) return true;
        if (reference.flag !== "read" || isBindingAssignmentTarget(identifier)) return false;
        const root = findTransparentExpressionRoot(identifier);
        const parent = root.parent;
        const isNamespace =
          isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
          isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
          getImportedName(symbol.declarationNode) === "default";
        const api =
          isNamespace && isNodeOfType(parent, "MemberExpression")
            ? getStaticPropertyName(parent)
            : getImportedName(symbol.declarationNode);
        const invocation =
          isNamespace && parent ? findTransparentExpressionRoot(parent).parent : parent;
        return Boolean(
          api &&
          NATIVE_MEDIA_REF_REACT_APIS.has(api) &&
          isNodeOfType(invocation, "CallExpression") &&
          !invocation.optional &&
          stripParenExpression(invocation.callee) === (isNamespace ? parent : root) &&
          isClosedNativeMediaReactApiCall(invocation, api, context),
        );
      })
    ) {
      closedNativeMediaPrograms.set(context.scopes, false);
      return false;
    }
  }

  closedNativeMediaPrograms.set(context.scopes, true);
  return true;
};

const hasClosedNativeMediaRefSnapshot = ({
  expression,
  effectFunction,
  context,
}: ClosedNativeMediaRefSnapshotInput): boolean => {
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "Identifier")) return false;
  const snapshot = context.scopes.symbolFor(node);
  const declaration = snapshot?.declarationNode;
  const current = snapshot?.initializer ? stripParenExpression(snapshot.initializer) : null;
  const owner = findEnclosingFunction(effectFunction);
  if (
    !snapshot ||
    !isReadonlyNativeMediaBinding(snapshot) ||
    !owner ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== snapshot.bindingIdentifier ||
    findEnclosingFunction(declaration) !== effectFunction ||
    !isNodeOfType(current, "MemberExpression") ||
    current.optional ||
    current.computed ||
    getStaticPropertyName(current) !== "current"
  )
    return false;
  const ref = resolveReactRefSymbol(current, context.scopes, { allowUnboundBareCalls: false });
  const refCall = ref?.initializer ? stripParenExpression(ref.initializer) : null;
  const refReceiver = stripParenExpression(current.object);
  const providerIdentifier = isNodeOfType(refCall, "CallExpression")
    ? getRootIdentifier(refCall.callee)
    : null;
  const provider = providerIdentifier ? context.scopes.symbolFor(providerIdentifier) : null;
  const providerImport = provider ? getImportDeclarationForSymbol(provider) : null;
  if (
    !ref ||
    !isReadonlyNativeMediaBinding(ref) ||
    !isNodeOfType(refReceiver, "Identifier") ||
    context.scopes.symbolFor(refReceiver) !== ref ||
    !isNodeOfType(ref.declarationNode, "VariableDeclarator") ||
    ref.declarationNode.id !== ref.bindingIdentifier ||
    findEnclosingFunction(ref.declarationNode) !== owner ||
    !isNodeOfType(refCall, "CallExpression") ||
    refCall.optional ||
    refCall.arguments.length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT ||
    !isNodeOfType(refCall.arguments[FIRST_ARGUMENT_INDEX], "Literal") ||
    refCall.arguments[FIRST_ARGUMENT_INDEX].value !== null ||
    ref.declarationNode.range[1] > declaration.range[0] ||
    providerImport?.source.value !== "react" ||
    !isClosedNativeMediaReactApiCall(refCall, "useRef", context)
  )
    return false;

  if (!hasClosedNativeMediaRefProgram(context)) return false;

  let attachmentCount = 0;
  for (const reference of ref.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const parent = root.parent;
    if (isTypeScriptTypePosition(reference.identifier)) continue;
    if (
      isNodeOfType(parent, "JSXExpressionContainer") &&
      parent.expression === root &&
      isNodeOfType(parent.parent, "JSXAttribute") &&
      isNodeOfType(parent.parent.name, "JSXIdentifier") &&
      parent.parent.name.name === "ref"
    ) {
      const opening = parent.parent.parent;
      if (
        !isNodeOfType(opening, "JSXOpeningElement") ||
        !isNodeOfType(opening.name, "JSXIdentifier") ||
        !NATIVE_MEDIA_ELEMENT_NAMES.has(opening.name.name) ||
        opening.attributes.some(
          (attribute) =>
            isNodeOfType(attribute, "JSXSpreadAttribute") ||
            (isNodeOfType(attribute, "JSXAttribute") &&
              isNodeOfType(attribute.name, "JSXIdentifier") &&
              (attribute.name.name === "is" || attribute.name.name.startsWith("on"))),
        ) ||
        opening.attributes.filter(
          (attribute) =>
            isNodeOfType(attribute, "JSXAttribute") &&
            isNodeOfType(attribute.name, "JSXIdentifier") &&
            attribute.name.name === "ref",
        ).length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT ||
        !isNodeOfType(opening.parent, "JSXElement") ||
        findEnclosingFunction(opening) !== owner ||
        !isValueRenderedInSameRender(opening.parent, context.scopes, {
          doesCustomElementRenderChildren: () => true,
        })
      )
        return false;
      attachmentCount += 1;
      continue;
    }
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== root ||
      parent.optional ||
      parent.computed ||
      getStaticPropertyName(parent) !== "current" ||
      isMemberMutationTarget(parent) ||
      findEnclosingFunction(parent) !== effectFunction
    )
      return false;
    if (parent === current) continue;
    const use = findTransparentExpressionRoot(parent).parent;
    if (
      !(isNodeOfType(use, "UnaryExpression") && use.operator === "!") &&
      !(
        isNodeOfType(use, "BinaryExpression") &&
        ["===", "!==", "==", "!="].includes(use.operator) &&
        ((use.left === parent && isNodeOfType(use.right, "Literal") && use.right.value === null) ||
          (use.right === parent && isNodeOfType(use.left, "Literal") && use.left.value === null))
      )
    )
      return false;
  }
  if (attachmentCount !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT) return false;

  const isSnapshotMember = (member: EsTreeNode): boolean =>
    isNodeOfType(member, "MemberExpression") &&
    !member.optional &&
    !member.computed &&
    isNodeOfType(stripParenExpression(member.object), "Identifier") &&
    context.scopes.symbolFor(stripParenExpression(member.object)) === snapshot;
  const isListenerCall = (call: EsTreeNode, handler: SymbolDescriptor): boolean => {
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      !isNodeOfType(call.callee, "MemberExpression") ||
      !isSnapshotMember(call.callee) ||
      call.arguments.length !== NATIVE_MEDIA_REF_LISTENER_ARGUMENT_COUNT ||
      !["addEventListener", "removeEventListener"].includes(
        getStaticPropertyName(call.callee) ?? "",
      )
    )
      return false;
    const event = call.arguments[FIRST_ARGUMENT_INDEX];
    const callback = call.arguments[SECOND_ARGUMENT_INDEX];
    return (
      isNodeOfType(event, "Literal") &&
      typeof event.value === "string" &&
      NATIVE_MEDIA_REF_EVENT_NAMES.has(event.value) &&
      isNodeOfType(callback, "Identifier") &&
      context.scopes.symbolFor(callback) === handler
    );
  };
  const isLocalHandler = (identifier: EsTreeNode): boolean => {
    if (!isNodeOfType(identifier, "Identifier")) return false;
    const handler = context.scopes.symbolFor(identifier);
    const initializer = handler?.initializer ? stripParenExpression(handler.initializer) : null;
    return Boolean(
      handler &&
      isReadonlyNativeMediaBinding(handler) &&
      findEnclosingFunction(handler.declarationNode) === effectFunction &&
      isNodeOfType(initializer, "ArrowFunctionExpression") &&
      !initializer.async &&
      initializer.params.length === NATIVE_MEDIA_EFFECT_PARAMETER_COUNT &&
      handler.references.every((reference) => {
        const root = findTransparentExpressionRoot(reference.identifier);
        const call = root.parent;
        return (
          isNodeOfType(call, "CallExpression") &&
          ((call.callee === root &&
            !call.optional &&
            call.arguments.length === NATIVE_MEDIA_EFFECT_PARAMETER_COUNT) ||
            isListenerCall(call, handler))
        );
      }),
    );
  };
  return snapshot.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      !isSnapshotMember(member) ||
      isMemberMutationTarget(member)
    )
      return false;
    const frame = findEnclosingFunction(member);
    if (frame !== effectFunction) {
      if (
        !isNodeOfType(frame, "ArrowFunctionExpression") ||
        frame.async ||
        frame.params.length !== NATIVE_MEDIA_EFFECT_PARAMETER_COUNT
      )
        return false;
      const carrier = findTransparentExpressionRoot(frame).parent;
      const isCleanup =
        isNodeOfType(carrier, "ReturnStatement") &&
        findEnclosingFunction(carrier) === effectFunction;
      const isHandler = isNodeOfType(carrier, "VariableDeclarator") && isLocalHandler(carrier.id);
      if (!isCleanup && !isHandler) return false;
    }
    const property = getStaticPropertyName(member);
    if (property === "readyState") return true;
    const call = findTransparentExpressionRoot(member).parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== findTransparentExpressionRoot(member) ||
      call.optional
    )
      return false;
    if (property === "canPlayType")
      return (
        frame === effectFunction &&
        call.arguments.length === NATIVE_MEDIA_CALL_ARGUMENT_COUNT &&
        !isNodeOfType(call.arguments[FIRST_ARGUMENT_INDEX], "SpreadElement")
      );
    if (property === "play") return call.arguments.length === NATIVE_MEDIA_EFFECT_PARAMETER_COUNT;
    const callback = call.arguments[SECOND_ARGUMENT_INDEX];
    const handler = callback ? context.scopes.symbolFor(callback) : null;
    return Boolean(
      callback && handler && isLocalHandler(callback) && isListenerCall(call, handler),
    );
  });
};

export const isClosedNativeMediaRefSnapshot = (
  input: ClosedNativeMediaRefSnapshotInput,
): boolean => {
  const node = stripParenExpression(input.expression);
  if (!isNodeOfType(node, "Identifier")) return false;
  const snapshot = input.context.scopes.symbolFor(node);
  const declaration = snapshot?.declarationNode;
  if (
    !snapshot ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.range[1] > node.range[0]
  )
    return false;
  let bindings = nativeMediaSnapshotProofs.get(input.context.scopes);
  if (!bindings) {
    bindings = new WeakMap();
    nativeMediaSnapshotProofs.set(input.context.scopes, bindings);
  }
  let proofs = bindings.get(snapshot);
  if (!proofs) {
    proofs = new WeakMap();
    bindings.set(snapshot, proofs);
  }
  const cached = proofs.get(input.effectFunction);
  if (cached !== undefined) return cached;
  const closed = hasClosedNativeMediaRefSnapshot(input);
  proofs.set(input.effectFunction, closed);
  return closed;
};
