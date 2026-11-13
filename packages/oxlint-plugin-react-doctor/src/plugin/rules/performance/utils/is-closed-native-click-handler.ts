import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../../utils/is-react-component-name.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { collectJsxRuntimeImports } from "../../../utils/non-react-jsx-dialect.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getRuleSourceText } from "../../../utils/wrap-with-semantic-context.js";

const JSX_RUNTIME_PRAGMA_PATTERN = /@jsx(?:ImportSource|Runtime|Frag)?\b/;
const ordinaryJsxByScopes = new WeakMap<ScopeAnalysis, boolean>();
const indirectJsxProviderSources: ReadonlySet<string> = new Set([
  "module",
  "node:module",
  "process",
  "node:process",
]);
const opaqueProviderGlobals: ReadonlySet<string> = new Set([
  "React",
  "eval",
  "Function",
  "require",
  "module",
  "globalThis",
  "global",
  "self",
  "process",
]);

const isRuntimeProviderSource = (source: string): boolean =>
  source === "react" || source.startsWith("react/") || indirectJsxProviderSources.has(source);

const isOpaqueRuntimeSpecifier = (source: EsTreeNode): boolean =>
  !isNodeOfType(source, "Literal") ||
  typeof source.value !== "string" ||
  isRuntimeProviderSource(source.value);

const hasOrdinaryReactJsx = (context: RuleContext): boolean => {
  const { scopes } = context;
  const cached = ordinaryJsxByScopes.get(scopes);
  if (cached !== undefined) return cached;
  const program = scopes.rootScope.node;
  const source = getRuleSourceText(context);
  let hasOrdinaryJsx = false;
  if (isNodeOfType(program, "Program") && source && !JSX_RUNTIME_PRAGMA_PATTERN.test(source)) {
    const { hasNonReactRuntime, hasNonReactMarker } = collectJsxRuntimeImports(program);
    let reactDefault: SymbolDescriptor | null = null;
    let hasOpenJsxProvider = hasNonReactRuntime || hasNonReactMarker;
    for (const statement of program.body) {
      if (!isNodeOfType(statement, "ImportDeclaration") || isTypeOnlyImport(statement)) continue;
      if (statement.source.value !== "react") {
        if (isRuntimeProviderSource(statement.source.value)) hasOpenJsxProvider = true;
        continue;
      }
      for (const specifier of statement.specifiers) {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const isDefault =
          isNodeOfType(specifier, "ImportDefaultSpecifier") ||
          getImportedName(specifier) === "default";
        if (!isDefault && !isNodeOfType(specifier, "ImportNamespaceSpecifier")) continue;
        const binding = scopes.symbolFor(specifier.local);
        if (!binding || binding.references.length > 0) hasOpenJsxProvider = true;
        if (isDefault && specifier.local.name === "React") reactDefault = binding;
      }
    }
    const pendingScopes = [scopes.rootScope];
    while (pendingScopes.length > 0 && !hasOpenJsxProvider) {
      const scope = pendingScopes.pop();
      if (!scope) break;
      if (scope.symbols.some((symbol) => symbol.name === "React" && symbol !== reactDefault)) {
        hasOpenJsxProvider = true;
      }
      for (const child of scope.children) pendingScopes.push(child);
    }
    hasOrdinaryJsx = reactDefault !== null && !hasOpenJsxProvider;
    if (hasOrdinaryJsx) {
      walkAst(program, (node) => {
        if (!hasOrdinaryJsx) return false;
        if (
          (isNodeOfType(node, "Identifier") &&
            opaqueProviderGlobals.has(node.name) &&
            scopes.isGlobalReference(node)) ||
          (isNodeOfType(node, "ImportExpression") && isOpaqueRuntimeSpecifier(node.source)) ||
          (isNodeOfType(node, "TSImportEqualsDeclaration") &&
            node.importKind !== "type" &&
            isNodeOfType(node.moduleReference, "TSExternalModuleReference") &&
            isOpaqueRuntimeSpecifier(node.moduleReference.expression))
        ) {
          hasOrdinaryJsx = false;
          return false;
        }
      });
    }
  }
  ordinaryJsxByScopes.set(scopes, hasOrdinaryJsx);
  return hasOrdinaryJsx;
};

const isClosedModuleComponent = (owner: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const [binding, ...otherBindings] = getFunctionBindingSymbols(owner, scopes);
  if (
    !binding ||
    otherBindings.length > 0 ||
    binding.scope !== scopes.rootScope ||
    binding.scope.symbols.filter((symbol) => symbol.name === binding.name).length !== 1 ||
    !isReactComponentName(binding.name)
  ) {
    return false;
  }
  let declaration: EsTreeNode | null | undefined;
  if (isNodeOfType(owner, "FunctionDeclaration")) {
    if (binding.declarationNode !== owner || binding.kind !== "function") return false;
    const selfBinding = scopes.ownScopeFor(owner)?.symbolsByName.get(binding.name);
    if (selfBinding?.declarationNode !== owner || selfBinding.references.length !== 0) return false;
    declaration = owner;
  } else {
    const initializer = findTransparentExpressionRoot(owner);
    const declarator = initializer.parent;
    if (
      !isNodeOfType(owner, "ArrowFunctionExpression") ||
      binding.kind !== "const" ||
      binding.declarationNode !== declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== initializer
    ) {
      return false;
    }
    declaration = declarator.parent;
  }
  const declarationParent = declaration?.parent;
  const isExportedDeclaration =
    isNodeOfType(declarationParent, "ExportDefaultDeclaration") ||
    isNodeOfType(declarationParent, "ExportNamedDeclaration");
  return (
    (isExportedDeclaration ? declarationParent.parent : declarationParent) ===
      scopes.rootScope.node &&
    (isExportedDeclaration || binding.references.length > 0) &&
    binding.references.every(({ flag, identifier }) => {
      if (flag !== "read") return false;
      const use = identifier.parent;
      return (
        (isNodeOfType(use, "ExportSpecifier") && use.local === identifier) ||
        (isNodeOfType(use, "ExportDefaultDeclaration") && use.declaration === identifier)
      );
    })
  );
};

const reachesIntrinsicReturn = (opening: EsTreeNode, owner: EsTreeNode): boolean => {
  const element = opening.parent;
  if (!isNodeOfType(element, "JSXElement") || element.openingElement !== opening) return false;
  let value = findTransparentExpressionRoot(element);
  while (value.parent) {
    const parent = value.parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return parent.argument === value && findEnclosingFunction(parent) === owner;
    }
    if (isNodeOfType(parent, "JSXElement")) {
      const tag = parent.openingElement.name;
      if (!isNodeOfType(tag, "JSXIdentifier") || !HTML_TAGS.has(tag.name)) return false;
      if (!parent.children.some((child) => child === value)) return false;
    } else if (isNodeOfType(parent, "JSXFragment")) {
      if (!parent.children.some((child) => child === value)) return false;
    } else if (isNodeOfType(parent, "JSXExpressionContainer")) {
      if (parent.expression !== value) return false;
    } else if (isNodeOfType(parent, "LogicalExpression")) {
      if (parent.operator !== "&&" || parent.right !== value) return false;
    } else if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.consequent !== value && parent.alternate !== value) return false;
    } else {
      return false;
    }
    value = findTransparentExpressionRoot(parent);
  }
  return false;
};

const isDirectNativeClickReference = (reference: EsTreeNode, owner: EsTreeNode): boolean => {
  const expression = findTransparentExpressionRoot(reference);
  const container = expression.parent;
  if (!isNodeOfType(container, "JSXExpressionContainer") || container.expression !== expression) {
    return false;
  }
  const attribute = container.parent;
  if (!isEventHandlerAttribute(attribute) || getJsxAttributeName(attribute.name) !== "onClick") {
    return false;
  }
  const opening = attribute.parent;
  return (
    isNodeOfType(opening, "JSXOpeningElement") &&
    isNodeOfType(opening.name, "JSXIdentifier") &&
    opening.name.name === "button" &&
    opening.attributes.every(
      (prop) =>
        prop === attribute ||
        (isNodeOfType(prop, "JSXAttribute") && getJsxAttributeName(prop.name) !== "onClick"),
    ) &&
    reachesIntrinsicReturn(opening, owner)
  );
};

export const isClosedNativeClickHandler = (handler: EsTreeNode, context: RuleContext): boolean => {
  if (!isFunctionLike(handler) || handler.async || handler.generator) return false;
  const owner = findEnclosingFunction(handler);
  if (!isFunctionLike(owner) || !isNodeOfType(owner.body, "BlockStatement")) return false;

  const { scopes } = context;
  const [binding, ...otherBindings] = getFunctionBindingSymbols(handler, scopes);
  if (
    !binding ||
    otherBindings.length > 0 ||
    binding.scope.symbols.filter((symbol) => symbol.name === binding.name).length !== 1
  ) {
    return false;
  }
  if (isNodeOfType(handler, "FunctionDeclaration")) {
    if (handler.parent !== owner.body || binding.declarationNode !== handler) return false;
    const selfBinding = scopes.ownScopeFor(handler)?.symbolsByName.get(binding.name);
    if (selfBinding?.declarationNode !== handler || selfBinding.references.length !== 0)
      return false;
  } else {
    const initializer = findTransparentExpressionRoot(handler);
    const declaration = initializer.parent;
    if (
      (!isNodeOfType(handler, "ArrowFunctionExpression") &&
        (!isNodeOfType(handler, "FunctionExpression") || handler.id)) ||
      binding.kind !== "const" ||
      binding.declarationNode !== declaration ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== initializer ||
      declaration.parent?.parent !== owner.body
    ) {
      return false;
    }
  }
  return (
    binding.references.length > 0 &&
    binding.references.every(
      ({ flag, identifier }) => flag === "read" && isDirectNativeClickReference(identifier, owner),
    ) &&
    isClosedModuleComponent(owner, scopes) &&
    hasOrdinaryReactJsx(context)
  );
};
