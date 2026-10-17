import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isJsxFragmentElement } from "../../../utils/is-jsx-fragment-element.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NATIVE_SUBMIT_HANDLER_PARAMETER_COUNT,
  NATIVE_SUBMIT_MODULE_ARGUMENT_COUNT,
  NATIVE_SUBMIT_ATTRIBUTE_COUNT,
  NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT,
  NATIVE_SUBMIT_PROVIDER_MODULES,
  NATIVE_SUBMIT_RUNTIME_TYPESCRIPT_NODES,
  NATIVE_SUBMIT_UNSUPPORTED_GLOBALS,
} from "./constants.js";

interface NativeSubmitFunctionBinding {
  readonly functionNode:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">;
  readonly symbol: SymbolDescriptor;
}

const supportedPrograms = new WeakMap<ScopeAnalysis, boolean>();
const sourcePragmaProofs = new WeakMap<ScopeAnalysis, Map<string, boolean>>();
const navigationReferenceProofs = new WeakMap<SymbolDescriptor, boolean>();
const loadedRouterProofs = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();
const jsxChildrenByParent = new WeakMap<EsTreeNode, ReadonlySet<EsTreeNode>>();

const readDirectFunctionBinding = (
  node: EsTreeNode,
  context: RuleContext,
): NativeSubmitFunctionBinding | null => {
  if (!isNodeOfType(node, "ArrowFunctionExpression") && !isNodeOfType(node, "FunctionExpression")) {
    return null;
  }
  const declaration = node.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== node ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    (isNodeOfType(node, "FunctionExpression") && node.id !== null)
  ) {
    return null;
  }
  const symbol = context.scopes.symbolFor(declaration.id);
  if (
    !symbol ||
    getDirectConstInitializer(symbol) !== node ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  return { functionNode: node, symbol };
};

const isDirectJsxTagReference = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return Boolean(
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === identifier,
  );
};

const hasClosedProviderReferences = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) return true;
    if (reference.flag !== "read" || isWithinAssignmentTarget(identifier)) return false;
    const parent = identifier.parent;
    if (getImportedName(symbol.declarationNode) === "Fragment") {
      return isDirectJsxTagReference(identifier);
    }
    if (
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      isNodeOfType(parent, "CallExpression") &&
      parent.callee === identifier &&
      !parent.optional
    ) {
      return true;
    }
    if (
      !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
      !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
    ) {
      return false;
    }
    if (
      isNodeOfType(parent, "JSXMemberExpression") &&
      parent.object === identifier &&
      parent.property.name === "Fragment"
    ) {
      return isDirectJsxTagReference(parent);
    }
    return false;
  });

const isLoadedRouterProvider = (expression: EsTreeNode, context: RuleContext): boolean => {
  const current = stripParenExpression(expression);
  let proofs = loadedRouterProofs.get(context.scopes);
  if (!proofs) {
    proofs = new WeakMap();
    loadedRouterProofs.set(context.scopes, proofs);
  }
  const cached = proofs.get(current);
  if (cached !== undefined) return cached;
  proofs.set(current, false);
  let loaded = false;
  if (isNodeOfType(current, "Identifier")) {
    const symbol = context.scopes.symbolFor(current);
    const initializer = symbol && getDirectConstInitializer(symbol);
    loaded = Boolean(initializer && isLoadedRouterProvider(initializer, context));
  } else if (
    isNodeOfType(current, "MemberExpression") &&
    getStaticPropertyName(current) === "default"
  ) {
    loaded = isLoadedRouterProvider(current.object, context);
  } else if (
    isNodeOfType(current, "CallExpression") &&
    !current.optional &&
    current.arguments.length === NATIVE_SUBMIT_MODULE_ARGUMENT_COUNT &&
    isNodeOfType(current.callee, "MemberExpression") &&
    !current.callee.optional &&
    getStaticPropertyName(current.callee) === "require" &&
    isNodeOfType(current.callee.object, "Identifier") &&
    current.callee.object.name === "module" &&
    context.scopes.isGlobalReference(current.callee.object)
  ) {
    const [source] = current.arguments;
    loaded =
      isNodeOfType(source, "Literal") &&
      (source.value === "react-router" || source.value === "react-router-dom");
  }
  proofs.set(current, loaded);
  return loaded;
};

const hasClosedLoadedRouterUse = (node: EsTreeNode, context: RuleContext): boolean => {
  if (
    (!isNodeOfType(node, "Identifier") || context.scopes.referenceFor(node)) &&
    isLoadedRouterProvider(node, context)
  ) {
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === root) {
      const property = getStaticPropertyName(parent);
      return (
        property !== null &&
        ((property !== "useNavigate" && property !== "default") || !isMemberMutationTarget(parent))
      );
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === root &&
      isNodeOfType(parent.id, "Identifier") &&
      isNodeOfType(parent.parent, "VariableDeclaration") &&
      parent.parent.kind === "const"
    )
      return true;
    return isNodeOfType(parent, "UnaryExpression") && parent.operator === "void";
  }
  return true;
};

const hasSupportedProgram = (program: EsTreeNode, context: RuleContext): boolean => {
  const source = context.sourceCode?.getText?.();
  if (source === undefined) return false;
  let sourceProofs = sourcePragmaProofs.get(context.scopes);
  if (!sourceProofs) {
    sourceProofs = new Map();
    sourcePragmaProofs.set(context.scopes, sourceProofs);
  }
  let sourceSupported = sourceProofs.get(source);
  if (sourceSupported === undefined) {
    sourceSupported = !/@jsx(?:\s|Frag|ImportSource|Runtime)/u.test(source);
    sourceProofs.set(source, sourceSupported);
  }
  if (!sourceSupported) return false;
  const cached = supportedPrograms.get(context.scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      ("declare" in node && node.declare) ||
      NATIVE_SUBMIT_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression")
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (!hasClosedLoadedRouterUse(node, context)) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) {
      const reference = context.scopes.referenceFor(node);
      const symbol = reference?.resolvedSymbol;
      if (
        reference &&
        (symbol?.kind === "ts-interface" ||
          symbol?.kind === "ts-type-alias" ||
          (symbol?.kind === "import" && getValueImportSource(symbol) === null) ||
          (isNodeOfType(node, "Identifier") &&
            NATIVE_SUBMIT_UNSUPPORTED_GLOBALS.has(node.name) &&
            (node.name === "eval" || !symbol)))
      ) {
        supported = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration")) return;
    if (!NATIVE_SUBMIT_PROVIDER_MODULES.has(String(node.source.value))) return;
    for (const specifier of node.specifiers) {
      const symbol = context.scopes.symbolFor(specifier.local);
      if (symbol && getValueImportSource(symbol) && !hasClosedProviderReferences(symbol)) {
        supported = false;
        return false;
      }
    }
  });
  supportedPrograms.set(context.scopes, supported);
  return supported;
};

const isNativeContainer = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (
    opening.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXSpreadAttribute") ||
        (isNodeOfType(attribute, "JSXAttribute") && getJsxAttributeName(attribute.name) === "is"),
    )
  ) {
    return false;
  }
  if (isNodeOfType(opening.name, "JSXIdentifier") && HTML_TAGS.has(opening.name.name)) {
    return true;
  }
  if (!isJsxFragmentElement(opening, context.scopes)) return false;
  const name = opening.name;
  const identifier = isNodeOfType(name, "JSXMemberExpression") ? name.object : name;
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  return Boolean(symbol && getValueImportSource(symbol) === "react");
};

const isReturnedForm = (
  form: EsTreeNodeOfType<"JSXElement">,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  let current: EsTreeNode = form;
  for (;;) {
    const root = findTransparentExpressionRoot(current);
    const parent = root.parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return parent.argument === root && findEnclosingFunction(parent) === component;
    }
    if (isNodeOfType(component, "ArrowFunctionExpression") && component.body === root) {
      return true;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === root || parent.alternate === root)
    ) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === root) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXFragment") || isNodeOfType(parent, "JSXElement")) {
      let children = jsxChildrenByParent.get(parent);
      if (!children) {
        children = new Set(parent.children);
        jsxChildrenByParent.set(parent, children);
      }
      if (
        children.has(root) &&
        (isNodeOfType(parent, "JSXFragment") || isNativeContainer(parent.openingElement, context))
      ) {
        current = parent;
        continue;
      }
    }
    return false;
  }
};

const isSubmitAnchor = (
  identifier: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const expression = identifier.parent;
  const attribute = expression?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(expression, "JSXExpressionContainer") ||
    expression.expression !== identifier ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.name.name !== "form" ||
    !isNativeContainer(opening, context) ||
    getAuthoritativeJsxAttribute(opening.attributes, "onSubmit") !== attribute ||
    opening.attributes.filter(
      (candidate) =>
        isNodeOfType(candidate, "JSXAttribute") &&
        getJsxAttributeName(candidate.name) === "onSubmit",
    ).length !== NATIVE_SUBMIT_ATTRIBUTE_COUNT ||
    !isNodeOfType(opening.parent, "JSXElement")
  ) {
    return false;
  }
  return isReturnedForm(opening.parent, component, context);
};

export const isClosedNativeSubmitNavigation = (
  call: EsTreeNodeOfType<"CallExpression">,
  navigateDeclaration: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): boolean => {
  if (
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    !isNodeOfType(navigateDeclaration.id, "Identifier") ||
    !isNodeOfType(navigateDeclaration.init, "CallExpression") ||
    navigateDeclaration.init.optional ||
    navigateDeclaration.init.arguments.length !== NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT ||
    !isNodeOfType(navigateDeclaration.init.callee, "Identifier")
  ) {
    return false;
  }
  const navigateSymbol = context.scopes.symbolFor(navigateDeclaration.id);
  const hookSymbol = context.scopes.symbolFor(navigateDeclaration.init.callee);
  const hookSource = hookSymbol && getValueImportSource(hookSymbol);
  if (!navigateSymbol || getDirectConstInitializer(navigateSymbol) !== navigateDeclaration.init)
    return false;
  let referencesClosed = navigationReferenceProofs.get(navigateSymbol);
  if (referencesClosed === undefined) {
    referencesClosed = !navigateSymbol.references.some((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return false;
      const parent = reference.identifier.parent;
      return (
        reference.flag !== "read" ||
        !isNodeOfType(parent, "CallExpression") ||
        parent.callee !== reference.identifier ||
        parent.optional
      );
    });
    navigationReferenceProofs.set(navigateSymbol, referencesClosed);
  }
  if (
    !referencesClosed ||
    !hookSymbol ||
    getImportedName(hookSymbol.declarationNode) !== "useNavigate" ||
    (hookSource !== "react-router" && hookSource !== "react-router-dom")
  ) {
    return false;
  }
  const helperNode = findEnclosingFunction(call);
  const helper = helperNode && readDirectFunctionBinding(helperNode, context);
  if (
    !helper ||
    helper.functionNode.generator ||
    helper.functionNode.params.length !== NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT ||
    helper.symbol.references.length === NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT
  ) {
    return false;
  }
  const component = findEnclosingFunction(helper.symbol.declarationNode);
  if (!component || findEnclosingFunction(navigateDeclaration) !== component) return false;
  const componentBinding = readDirectFunctionBinding(component, context);
  if (
    !componentBinding ||
    componentBinding.functionNode.async ||
    componentBinding.functionNode.generator ||
    !/^[A-Z]/u.test(componentBinding.symbol.name)
  ) {
    return false;
  }
  if (
    componentBinding.symbol.references.some((reference) => {
      const identifier = reference.identifier;
      return !(
        isDirectJsxTagReference(identifier) ||
        (isNodeOfType(identifier.parent, "ExportDefaultDeclaration") &&
          identifier.parent.declaration === identifier)
      );
    })
  ) {
    return false;
  }
  let handler: NativeSubmitFunctionBinding | null = null;
  for (const reference of helper.symbol.references) {
    const helperCall = reference.identifier.parent;
    if (
      !isNodeOfType(helperCall, "CallExpression") ||
      helperCall.callee !== reference.identifier ||
      helperCall.optional ||
      helperCall.arguments.length !== NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT
    ) {
      return false;
    }
    const caller = findEnclosingFunction(helperCall);
    const binding = caller && readDirectFunctionBinding(caller, context);
    if (
      !binding ||
      binding.functionNode === helper.functionNode ||
      binding.functionNode.async ||
      binding.functionNode.generator ||
      binding.functionNode.params.length !== NATIVE_SUBMIT_HANDLER_PARAMETER_COUNT ||
      !binding.functionNode.params.every((parameter) => isNodeOfType(parameter, "Identifier")) ||
      findEnclosingFunction(binding.symbol.declarationNode) !== component ||
      (handler !== null && handler.symbol !== binding.symbol)
    ) {
      return false;
    }
    handler = binding;
  }
  if (!handler || handler.symbol.references.length === NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT) {
    return false;
  }
  if (
    !handler.symbol.references.every((reference) =>
      isSubmitAnchor(reference.identifier, component, context),
    )
  ) {
    return false;
  }
  const program = findProgramRoot(call);
  return Boolean(program && hasSupportedProgram(program, context));
};
