import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { REACT_RUNTIME_MODULE_SOURCES } from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getNodeEndIndex } from "../../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveReactRefObjectSymbol } from "../../../utils/react-ref-origin.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export interface OwnedAbortSignalCommandProof {
  readonly argumentFunctionReferences: ReadonlyArray<EsTreeNode>;
}

interface OwnedAbortSignalCommandOptions {
  call: EsTreeNode;
  context: RuleContext;
  isParentCallbackExpression: (expression: EsTreeNode) => boolean;
}

const unsafeNativeProviderByScopes = new WeakMap<ScopeAnalysis, boolean>();
const unsafeReactRefProviderByScopes = new WeakMap<ScopeAnalysis, boolean>();
const NATIVE_SIGNAL_CAPABILITY_NAMES = ["AbortSignal", "EventTarget", "Object", "Reflect"];

const hasUnsafeReactRefProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = unsafeReactRefProviderByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let unsafe = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (unsafe || isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ImportExpression")) unsafe = true;
    if (
      (isNodeOfType(node, "Identifier") || isNodeOfType(node, "MemberExpression")) &&
      isProvenGlobalNamespaceReference(node, "React", scopes)
    ) {
      unsafe = true;
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (
        (isNodeOfType(callee, "Identifier") && callee.name === "require") ||
        (isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "require")
      ) {
        unsafe = true;
      }
    }
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.importKind === "type" ||
      typeof node.source.value !== "string"
    ) {
      return;
    }
    const isReactModule = REACT_RUNTIME_MODULE_SOURCES.has(node.source.value);
    const isModuleProvider = node.source.value === "node:module" || node.source.value === "module";
    if (!isReactModule && !isModuleProvider) return;
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const symbol = scopes.symbolFor(specifier.local);
      const references = symbol?.references.filter(
        (reference) => !isTypeScriptTypePosition(reference.identifier),
      );
      if (!symbol || !references || references.length === 0) continue;
      if (
        isModuleProvider ||
        !isNodeOfType(specifier, "ImportSpecifier") ||
        !isSymbolReadOnly(symbol)
      ) {
        unsafe = true;
        continue;
      }
      if (
        references.some((reference) => {
          const identifier = findTransparentExpressionRoot(reference.identifier);
          const consumer = identifier.parent;
          return !isNodeOfType(consumer, "CallExpression") || consumer.callee !== identifier;
        })
      ) {
        unsafe = true;
      }
    }
  });
  unsafeReactRefProviderByScopes.set(scopes, unsafe);
  return unsafe;
};

const hasUnsafeNativeProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = unsafeNativeProviderByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let unsafe = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (unsafe || isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "WithStatement")) unsafe = true;
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval") unsafe = true;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      (isProvenGlobalNamespaceReference(node, "eval", scopes) ||
        isProvenGlobalNamespaceReference(node, "Function", scopes))
    ) {
      unsafe = true;
    }
    if (
      (isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Identifier") && scopes.referenceFor(node))) &&
      NATIVE_SIGNAL_CAPABILITY_NAMES.some((namespaceName) => {
        if (!isProvenGlobalNamespaceReference(node, namespaceName, scopes)) return false;
        if (
          !isProvenUnmodifiedGlobalNamespaceReference(node, namespaceName, scopes, undefined, true)
        ) {
          return true;
        }
        const expression = findTransparentExpressionRoot(node);
        const consumer = expression.parent;
        if (
          (isNodeOfType(consumer, "MemberExpression") && consumer.object === expression) ||
          ((isNodeOfType(consumer, "CallExpression") || isNodeOfType(consumer, "NewExpression")) &&
            consumer.callee === expression) ||
          (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "typeof")
        ) {
          return false;
        }
        if (
          isNodeOfType(consumer, "VariableDeclarator") &&
          consumer.init === expression &&
          isNodeOfType(consumer.id, "Identifier")
        ) {
          const alias = scopes.symbolFor(consumer.id);
          return !alias || alias.kind !== "const" || !isSymbolReadOnly(alias);
        }
        return true;
      })
    ) {
      unsafe = true;
    }
    if (!isNodeOfType(node, "MemberExpression")) return;
    const property = getStaticPropertyName(node);
    if (property === "constructor" || property === "__proto__" || property === "prototype")
      unsafe = true;
    if (
      (property === null || property === "getPrototypeOf") &&
      (NATIVE_SIGNAL_CAPABILITY_NAMES.some((namespaceName) =>
        isProvenGlobalNamespaceReference(node.object, namespaceName, scopes),
      ) ||
        isProvenGlobalObjectReference(node.object, scopes))
    ) {
      unsafe = true;
    }
    if (
      isProvenGlobalNamespaceReference(node, "eval", scopes) ||
      isProvenGlobalNamespaceReference(node, "Function", scopes)
    ) {
      unsafe = true;
    }
  });
  unsafeNativeProviderByScopes.set(scopes, unsafe);
  return unsafe;
};

const isBooleanControlRead = (expression: EsTreeNode): boolean => {
  let current = findTransparentExpressionRoot(expression);
  while (current.parent) {
    const parent = current.parent;
    if (
      (isNodeOfType(parent, "IfStatement") ||
        isNodeOfType(parent, "ConditionalExpression") ||
        isNodeOfType(parent, "WhileStatement")) &&
      parent.test === current
    ) {
      return true;
    }
    if (
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
      isNodeOfType(parent, "LogicalExpression")
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return false;
};

const isDirectMember = (expression: EsTreeNode | null | undefined, property: string): boolean =>
  isNodeOfType(expression, "MemberExpression") &&
  !expression.computed &&
  !expression.optional &&
  getStaticPropertyName(expression) === property;

const isNoArgumentAbort = (expression: EsTreeNode): boolean => {
  const member = expression.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== expression ||
    member.computed ||
    getStaticPropertyName(member) !== "abort"
  ) {
    return false;
  }
  const call = member.parent;
  return (
    isNodeOfType(call, "CallExpression") && call.callee === member && call.arguments.length === 0
  );
};

export const getOwnedAbortSignalCommandProof = ({
  call,
  context,
  isParentCallbackExpression,
}: OwnedAbortSignalCommandOptions): OwnedAbortSignalCommandProof | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isParentCallbackExpression(call.callee)
  ) {
    return null;
  }
  const [argument, ...otherArguments] = call.arguments;
  if (!argument || otherArguments.length > 0) return null;
  const signal = stripParenExpression(argument);
  if (!isNodeOfType(signal, "MemberExpression") || !isDirectMember(signal, "signal")) return null;
  const receiver = stripParenExpression(signal.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const scopes = context.scopes;
  const controller = scopes.symbolFor(receiver);
  const initializer = controller ? getDirectConstInitializer(controller) : null;
  const creation = initializer ? stripParenExpression(initializer) : null;
  if (
    !controller ||
    !isSymbolReadOnly(controller) ||
    !isNodeOfType(creation, "NewExpression") ||
    creation.arguments.length > 0 ||
    !isNodeOfType(creation.callee, "Identifier") ||
    creation.callee.name !== "AbortController" ||
    !scopes.isGlobalReference(creation.callee) ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      creation.callee,
      "AbortController",
      scopes,
      undefined,
      true,
    ) ||
    hasUnsafeNativeProvider(scopes)
  ) {
    return null;
  }
  const owner = findEnclosingFunction(controller.declarationNode);
  if (
    !owner ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    findEnclosingFunction(call) !== owner
  )
    return null;
  let hasUnsupportedWork = false;
  walkAst(owner, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      node !== call &&
      (isParentCallbackExpression(node.callee) ||
        node.arguments.some((value) => isParentCallbackExpression(value)))
    ) {
      hasUnsupportedWork = true;
    }
    const start = getNodeStartIndex(node);
    if (start < getNodeEndIndex(creation) || start >= getNodeStartIndex(call)) return;
    if (
      isNodeOfType(node, "CallExpression") ||
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "AwaitExpression") ||
      isNodeOfType(node, "YieldExpression")
    ) {
      hasUnsupportedWork = true;
    }
  });
  if (hasUnsupportedWork) return null;

  let ownedRef: SymbolDescriptor | null = null;
  for (const reference of controller.references) {
    if (isTypeScriptTypePosition(reference.identifier)) continue;
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const assignment = identifier.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.right !== identifier
    ) {
      continue;
    }
    const target = stripParenExpression(assignment.left);
    if (!isNodeOfType(target, "MemberExpression") || !isDirectMember(target, "current"))
      return null;
    const refObject = stripParenExpression(target.object);
    if (!isNodeOfType(refObject, "Identifier")) return null;
    const ref = resolveReactRefObjectSymbol(refObject, scopes);
    const refInitializer = ref ? getDirectConstInitializer(ref) : null;
    const refCallee = isNodeOfType(refInitializer, "CallExpression")
      ? stripParenExpression(refInitializer.callee)
      : null;
    const refProvider = refCallee ? scopes.symbolFor(refCallee) : null;
    const importedRefApi = refCallee ? resolveImportedApiReference(refCallee, scopes) : null;
    const refOwner = ref ? findEnclosingFunction(ref.declarationNode) : null;
    const refArguments = isNodeOfType(refInitializer, "CallExpression")
      ? refInitializer.arguments
      : [];
    const [initialRefValue, ...otherRefArguments] = refArguments;
    if (
      !ref ||
      scopes.symbolFor(refObject) !== ref ||
      !isSymbolReadOnly(ref) ||
      !isNodeOfType(refInitializer, "CallExpression") ||
      !isNodeOfType(refCallee, "Identifier") ||
      !refProvider ||
      refProvider.kind !== "import" ||
      !isSymbolReadOnly(refProvider) ||
      !importedRefApi ||
      importedRefApi.importedName !== "useRef" ||
      !REACT_RUNTIME_MODULE_SOURCES.has(importedRefApi.source) ||
      hasUnsafeReactRefProvider(scopes) ||
      otherRefArguments.length > 0 ||
      !isNodeOfType(initialRefValue, "Literal") ||
      initialRefValue.value !== null ||
      !refOwner ||
      !isAstDescendant(owner, refOwner) ||
      (ownedRef !== null && ownedRef !== ref)
    ) {
      return null;
    }
    ownedRef = ref;
  }

  const isOwnedRefCurrent = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "MemberExpression") &&
    isDirectMember(node, "current") &&
    scopes.symbolFor(stripParenExpression(node.object)) === ownedRef &&
    ownedRef !== null;
  const isController = (node: EsTreeNode): boolean =>
    isNodeOfType(stripParenExpression(node), "Identifier") &&
    scopes.symbolFor(stripParenExpression(node)) === controller;
  const isIdentityGuard = (
    expression: EsTreeNode,
    matchesOther: (node: EsTreeNode) => boolean,
  ): boolean => {
    const comparison = expression.parent;
    return (
      isNodeOfType(comparison, "BinaryExpression") &&
      (comparison.operator === "===" || comparison.operator === "!==") &&
      matchesOther(comparison.left === expression ? comparison.right : comparison.left) &&
      isBooleanControlRead(comparison)
    );
  };

  if (ownedRef) {
    for (const reference of ownedRef.references) {
      if (isTypeScriptTypePosition(reference.identifier)) continue;
      const identifier = findTransparentExpressionRoot(reference.identifier);
      const current = identifier.parent;
      if (!current || !isOwnedRefCurrent(current)) return null;
      const currentRoot = findTransparentExpressionRoot(current);
      const consumer = currentRoot.parent;
      if (
        isNodeOfType(consumer, "AssignmentExpression") &&
        consumer.operator === "=" &&
        consumer.left === currentRoot &&
        (isController(consumer.right) ||
          (isNodeOfType(consumer.right, "Literal") && consumer.right.value === null))
      ) {
        continue;
      }
      if (
        isNoArgumentAbort(currentRoot) ||
        isBooleanControlRead(currentRoot) ||
        isIdentityGuard(currentRoot, isController)
      ) {
        continue;
      }
      return null;
    }
  }

  const hasOnlyOwnedUses = controller.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const consumer = identifier.parent;
    if (
      isNodeOfType(consumer, "AssignmentExpression") &&
      consumer.operator === "=" &&
      consumer.right === identifier &&
      isOwnedRefCurrent(consumer.left)
    ) {
      return true;
    }
    if (isIdentityGuard(identifier, isOwnedRefCurrent)) return true;
    if (isNoArgumentAbort(identifier)) return getNodeStartIndex(identifier) > getNodeEndIndex(call);
    if (
      !isNodeOfType(consumer, "MemberExpression") ||
      !isDirectMember(consumer, "signal") ||
      consumer.object !== identifier
    ) {
      return false;
    }
    const signalRoot = findTransparentExpressionRoot(consumer);
    if (signalRoot.parent === call && stripParenExpression(call.arguments[0]) === consumer)
      return true;
    const property = signalRoot.parent;
    return (
      isNodeOfType(property, "MemberExpression") &&
      property.object === signalRoot &&
      isDirectMember(property, "aborted") &&
      isBooleanControlRead(property)
    );
  });
  const ownedRefInitializer = ownedRef ? getDirectConstInitializer(ownedRef) : null;
  return hasOnlyOwnedUses
    ? {
        argumentFunctionReferences: [
          creation.callee,
          controller.bindingIdentifier,
          ...controller.references.map((reference) => reference.identifier),
          ...(isNodeOfType(ownedRefInitializer, "CallExpression")
            ? [stripParenExpression(ownedRefInitializer.callee)]
            : []),
        ],
      }
    : null;
};
