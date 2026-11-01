import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { REACT_RUNTIME_MODULE_SOURCES } from "../../../constants/react.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasJsxRuntimePragma } from "../../../utils/has-jsx-runtime-pragma.js";
import { hasOnlyErasedTypeNameBindings } from "../../../utils/has-only-erased-type-name-bindings.js";
import { hasVisibleAmbientFunctionDeclaration } from "../../../utils/has-visible-ambient-function-declaration.js";
import { isProvenGlobalObjectReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveRuntimeValueBinding } from "../../../utils/resolve-runtime-value-binding.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  REF_NOTIFICATION_RUNTIME_CAPABILITIES,
  REF_NOTIFICATION_RUNTIME_TYPESCRIPT,
  REF_NOTIFICATION_PASSIVE_OBJECT_METHODS,
} from "./constants.js";

interface RefNotificationReactCallOptions {
  readonly allowNativeWindowEventListeners?: boolean;
}

interface RefNotificationReactCertificate {
  readonly allowNativeWindowEventListeners: boolean;
  readonly sourceText: string;
  readonly filename: string;
  readonly accepted: ReadonlySet<SymbolDescriptor>;
}
const certificates = new WeakMap<ScopeAnalysis, RefNotificationReactCertificate>();

export const hasRefNotificationReactCall = (
  call: EsTreeNode,
  apiName: string,
  context: RuleContext,
  options: RefNotificationReactCallOptions = {},
): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const scopes = context.scopes;
  const symbol = resolveRuntimeValueBinding(scopes.scopeFor(callee), callee.name);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !declaration ||
    declaration.importKind === "type" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    !REACT_RUNTIME_MODULE_SOURCES.has(String(declaration.source.value)) ||
    getImportedName(symbol.declarationNode) !== apiName
  )
    return false;
  const sourceText = context.sourceCode?.getText?.();
  const filename = context.filename ?? "/synthetic/ref-notification.tsx";
  const program = findProgramRoot(call);
  if (sourceText === undefined || !program) return false;
  const allowNativeWindowEventListeners = options.allowNativeWindowEventListeners === true;
  const cached = certificates.get(scopes);
  if (
    cached?.sourceText === sourceText &&
    cached.filename === filename &&
    cached.allowNativeWindowEventListeners === allowNativeWindowEventListeners
  )
    return cached.accepted.has(symbol);
  const imports = new Map<SymbolDescriptor, boolean>();
  const namespaceImports = new Set<SymbolDescriptor>();
  let unsupported = hasJsxRuntimePragma({ program, filename, sourceText });
  for (const candidate of scopes.rootScope.symbols) {
    const imported = getImportDeclarationForSymbol(candidate);
    if (!imported || imported.importKind === "type") continue;
    if (
      imported.source.value === "preact" ||
      imported.source.value === "react/jsx-runtime" ||
      imported.source.value === "react/jsx-dev-runtime"
    )
      unsupported = true;
    if (!REACT_RUNTIME_MODULE_SOURCES.has(String(imported.source.value))) continue;
    if (
      isNodeOfType(candidate.declarationNode, "ImportSpecifier") &&
      candidate.declarationNode.importKind !== "type" &&
      getImportedName(candidate.declarationNode) !== "default"
    )
      imports.set(candidate, true);
    else {
      namespaceImports.add(candidate);
      if (candidate.references.length > 0) unsupported = true;
    }
  }
  walkAst(program, (node) => {
    if (unsupported) return false;
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration") ||
      isNodeOfType(node, "ImportDeclaration")
    )
      return false;
    if (REF_NOTIFICATION_RUNTIME_TYPESCRIPT.has(node.type)) {
      unsupported = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      ["constructor", "__proto__", "prototype", "__defineGetter__", "__defineSetter__"].includes(
        (allowNativeWindowEventListeners
          ? getResolvedStaticPropertyName(node, scopes)
          : getStaticPropertyName(node)) ?? "",
      )
    ) {
      unsupported = true;
      return false;
    }
    if (
      (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
      isNonReferenceIdentifier(node)
    )
      return;
    if (
      REF_NOTIFICATION_RUNTIME_CAPABILITIES.has(node.name) ||
      (allowNativeWindowEventListeners && isProvenGlobalObjectReference(node, scopes))
    ) {
      const capabilitySymbol = scopes.symbolFor(node);
      const member = node.parent;
      const root = member && findTransparentExpressionRoot(member);
      const invocation = root?.parent;
      const passiveObjectCall =
        node.name === "Object" &&
        (scopes.isGlobalReference(node) ||
          Boolean(capabilitySymbol && hasOnlyErasedTypeNameBindings(capabilitySymbol))) &&
        !hasVisibleAmbientFunctionDeclaration(scopes.scopeFor(node), node.name) &&
        isNodeOfType(member, "MemberExpression") &&
        member.object === node &&
        !member.computed &&
        !member.optional &&
        REF_NOTIFICATION_PASSIVE_OBJECT_METHODS.has(getStaticPropertyName(member) ?? "") &&
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === root &&
        !invocation.optional;
      const [eventName, listener, capture, ...extraArguments] = isNodeOfType(
        invocation,
        "CallExpression",
      )
        ? invocation.arguments
        : [];
      const listenerSymbol = isNodeOfType(listener, "Identifier")
        ? resolveRuntimeValueBinding(scopes.scopeFor(listener), listener.name)
        : null;
      const nativeWindowEventCall =
        allowNativeWindowEventListeners &&
        node.name === "window" &&
        scopes.isGlobalReference(node) &&
        !hasVisibleAmbientFunctionDeclaration(scopes.scopeFor(node), node.name) &&
        isNodeOfType(member, "MemberExpression") &&
        member.object === node &&
        !member.computed &&
        !member.optional &&
        (getStaticPropertyName(member) === "addEventListener" ||
          getStaticPropertyName(member) === "removeEventListener") &&
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === root &&
        !invocation.optional &&
        isNodeOfType(eventName, "Literal") &&
        typeof eventName.value === "string" &&
        listenerSymbol?.kind === "const" &&
        hasCompleteSymbolReferences(listenerSymbol, program, scopes) &&
        listenerSymbol.references.every(
          (reference) =>
            reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
        ) &&
        (capture === undefined ||
          (isNodeOfType(capture, "Literal") && typeof capture.value === "boolean")) &&
        extraArguments.length === 0;
      if (!passiveObjectCall && !nativeWindowEventCall) {
        unsupported = true;
        return false;
      }
    }
    const resolved = resolveRuntimeValueBinding(scopes.scopeFor(node), node.name);
    if (resolved && namespaceImports.has(resolved)) {
      unsupported = true;
      return false;
    }
    if (!resolved || !imports.has(resolved) || node === resolved.bindingIdentifier) return;
    const reference = scopes.referenceFor(node);
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (
      !reference ||
      reference.flag !== "read" ||
      isWithinAssignmentTarget(node) ||
      !isNodeOfType(parent, "CallExpression") ||
      parent.callee !== root ||
      parent.optional
    )
      imports.set(resolved, false);
  });
  const accepted = new Set<SymbolDescriptor>();
  if (!unsupported) for (const [imported, valid] of imports) if (valid) accepted.add(imported);
  certificates.set(scopes, { sourceText, filename, accepted, allowNativeWindowEventListeners });
  return accepted.has(symbol);
};
