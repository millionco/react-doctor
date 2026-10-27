import { hasReadonlyAsyncEventBinding } from "./has-readonly-async-event-binding.js";
import type { AsyncEventSourceModule } from "./has-readonly-async-event-binding.js";
import type { ResolvedCrossFileValueExport } from "../../../utils/resolve-cross-file-function-export.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { hasCanonicalControlPackageProfile } from "./has-canonical-control-package-profile.js";
import { OBJECT_PROTOTYPE_PROPERTY_NAMES } from "../../../utils/constants.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasJsxRuntimePragma } from "../../../utils/has-jsx-runtime-pragma.js";
import { isEventHandlerName } from "./event-handler-reference.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { hasStandardReactJsxConfiguration } from "../../../utils/resolve-tsconfig-alias.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { unwrapProvenReactHocFunction } from "../../../utils/unwrap-proven-react-hoc-function.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES,
  IMPORTED_NATIVE_CONTROL_REACT_API_NAMES,
  IMPORTED_NATIVE_CONTROL_SINGLE_COUNT,
  IMPORTED_NATIVE_CONTROL_RENDER_PARAMETER_COUNT,
  CANONICAL_CONTROL_REFUSED_GLOBAL_NAMES,
} from "./constants.js";

import { readDirectReferencedTsconfig } from "./read-direct-referenced-tsconfig.js";
import { resolveReferencedTsconfigAliasPath } from "./resolve-referenced-tsconfig-alias-path.js";

const resolveControlValueExport = (
  filename: string,
  source: string,
  exportedName: string,
): ResolvedCrossFileValueExport | null => {
  const direct = resolveCrossFileValueExportWithFilePath(filename, source, exportedName, {
    requireCompleteReexports: true,
  });
  if (direct) return direct;
  const referenced = resolveReferencedTsconfigAliasPath(filename, source);
  return referenced
    ? resolveCrossFileValueExportWithFilePath(
        filename,
        referenced.relativeSpecifier,
        exportedName,
        { requireCompleteReexports: true },
      )
    : null;
};

interface ResolveImportedNativeControlEventPropInput {
  readonly attribute: EsTreeNodeOfType<"JSXAttribute">;
  readonly context: Pick<RuleContext, "filename" | "scopes">;
}

interface NativeControlProp {
  readonly symbol: SymbolDescriptor;
  readonly defaultValue: EsTreeNode | null;
}

const hasClosedReads = (
  symbol: SymbolDescriptor,
  allowedIdentifiers: ReadonlySet<EsTreeNode>,
  module: AsyncEventSourceModule,
): boolean =>
  hasOnlyAllowedSymbolReads({
    symbol,
    allowedIdentifiers,
    program: module.program,
    scopes: module.scopes,
  });

const hasOrdinaryReactSource = (module: AsyncEventSourceModule): boolean => {
  const sourceText = fs.readFileSync(module.filename, "utf8");
  if (readDirectReferencedTsconfig(module.filename) === false) return false;
  const pendingScopes = [module.scopes.rootScope];
  while (pendingScopes.length) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    pendingScopes.push(...scope.children);
    for (const symbol of scope.symbols) {
      if (
        symbol.name !== "React" ||
        symbol.kind === "ts-interface" ||
        symbol.kind === "ts-type-alias"
      )
        continue;
      const declaration = getImportDeclarationForSymbol(symbol);
      if (
        declaration?.importKind === "type" ||
        (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
          symbol.declarationNode.importKind === "type")
      )
        continue;
      const imported = getImportBindingForName(module.program, symbol.name);
      if (
        symbol.kind !== "import" ||
        !imported ||
        imported.source !== "react" ||
        (!imported.isNamespace && imported.exportedName !== "default")
      )
        return false;
    }
  }

  if (
    hasJsxRuntimePragma({ filename: module.filename, program: module.program, sourceText }) ||
    !hasStandardReactJsxConfiguration(module.filename) ||
    resolveModulePath(module.filename, "react")
  )
    return false;
  if (
    [...IMPORTED_NATIVE_CONTROL_REACT_API_NAMES].some((name) =>
      hasReactDefaultProviderMutation(name, module.scopes),
    )
  )
    return false;
  let supported = true;
  walkAst(module.program, (node) => {
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      node.source.value !== "react" &&
      node.specifiers.some((specifier) => isNodeOfType(specifier, "ImportNamespaceSpecifier"))
    )
      supported = false;
    if (
      isNodeOfType(node, "CallExpression") &&
      isReactApiCall(node, IMPORTED_NATIVE_CONTROL_REACT_API_NAMES, module.scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: true,
        resolveNamedAliases: true,
      }) &&
      !isProvenUnmodifiedReactApiCall(node, IMPORTED_NATIVE_CONTROL_REACT_API_NAMES, module.scopes)
    )
      supported = false;
    return supported;
  });
  return supported;
};

const hasClosedComponentBinding = (
  symbol: SymbolDescriptor,
  module: AsyncEventSourceModule,
): boolean => {
  const allowed = new Set<EsTreeNode>();
  for (const reference of symbol.references) {
    const identifier = reference.identifier;
    const root = findTransparentExpressionRoot(identifier);
    const parent = root.parent;
    if (
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === root
    )
      allowed.add(identifier);
    else if (isNodeOfType(parent, "ExportSpecifier") && parent.local === root)
      allowed.add(identifier);
    else if (isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === root)
      allowed.add(identifier);
    else if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === root &&
      getStaticPropertyName(parent) === "displayName" &&
      isNodeOfType(parent.parent, "AssignmentExpression") &&
      parent.parent.left === parent &&
      parent.parent.operator === "=" &&
      isNodeOfType(parent.parent.right, "Literal") &&
      typeof parent.parent.right.value === "string"
    )
      allowed.add(identifier);
    else return false;
  }
  return hasClosedReads(symbol, allowed, module);
};

interface NativeControlAliasInput {
  readonly modules: readonly AsyncEventSourceModule[];
  readonly resolved: ResolvedCrossFileValueExport;
}

const hasClosedImportedControlAliases = ({
  modules,
  resolved,
}: NativeControlAliasInput): boolean => {
  for (const module of modules) {
    for (const symbol of module.scopes.rootScope.symbols) {
      if (symbol.kind !== "import") continue;
      const imported = getImportBindingForName(module.program, symbol.name);
      if (!imported || imported.isNamespace || imported.exportedName === null) continue;
      const importedValue = resolveControlValueExport(
        module.filename,
        imported.source,
        imported.exportedName,
      );
      if (
        importedValue?.filePath === resolved.filePath &&
        importedValue.exportedNode === resolved.exportedNode &&
        !hasClosedComponentBinding(symbol, module)
      )
        return false;
    }
  }
  return true;
};

const hasClosedPlainStyledProviders = (module: AsyncEventSourceModule): boolean => {
  if (
    !hasCanonicalControlPackageProfile({
      filename: module.filename,
      packageName: "styled-components",
    })
  )
    return false;
  let supported = true;
  walkAst(module.program, (node) => {
    if (!supported) return false;
    if (isNodeOfType(node, "ImportExpression") || isNodeOfType(node, "TSImportEqualsDeclaration")) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      CANONICAL_CONTROL_REFUSED_GLOBAL_NAMES.has(node.name) &&
      module.scopes.isGlobalReference(node)
    ) {
      supported = false;
      return false;
    }
    if (
      (isNodeOfType(node, "ExportAllDeclaration") ||
        isNodeOfType(node, "ExportNamedDeclaration")) &&
      node.source?.value === "styled-components" &&
      node.exportKind !== "type"
    ) {
      supported = false;
      return false;
    }
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.importKind === "type" ||
      node.source.value !== "styled-components"
    )
      return;
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const imported = getImportBindingForName(module.program, specifier.local.name);
      const symbol = module.scopes.symbolFor(specifier.local);
      if (
        !imported ||
        imported.isNamespace ||
        !["default", "css"].includes(imported.exportedName ?? "") ||
        !symbol ||
        !hasReadonlyAsyncEventBinding(symbol, module)
      ) {
        supported = false;
        return false;
      }
      const allowed = new Set<EsTreeNode>();
      for (const reference of symbol.references) {
        let use = findTransparentExpressionRoot(reference.identifier);
        if (imported.exportedName === "default") {
          const parent = use.parent;
          if (
            isNodeOfType(parent, "MemberExpression") &&
            parent.object === use &&
            !parent.computed &&
            !parent.optional
          ) {
            const name = getStaticPropertyName(parent);
            if (!name || name === "prototype" || OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name)) {
              supported = false;
              return false;
            }
            use = findTransparentExpressionRoot(parent);
          } else if (
            isNodeOfType(parent, "CallExpression") &&
            parent.callee === use &&
            !parent.optional &&
            parent.arguments.length === IMPORTED_NATIVE_CONTROL_SINGLE_COUNT
          )
            use = findTransparentExpressionRoot(parent);
        }
        if (!isNodeOfType(use.parent, "TaggedTemplateExpression") || use.parent.tag !== use) {
          supported = false;
          return false;
        }
        allowed.add(reference.identifier);
      }
      if (!hasClosedReads(symbol, allowed, module)) supported = false;
    }
  });
  return supported;
};

const readPlainStyledControlHost = (
  expression: EsTreeNode,
  module: AsyncEventSourceModule,
): string | null => {
  if (!isNodeOfType(expression, "TaggedTemplateExpression")) return null;
  const tag = stripParenExpression(expression.tag);
  let provider: EsTreeNode;
  let host: string | null = null;
  if (isNodeOfType(tag, "MemberExpression") && !tag.computed && !tag.optional) {
    provider = stripParenExpression(tag.object);
    host = getStaticPropertyName(tag);
  } else if (
    isNodeOfType(tag, "CallExpression") &&
    !tag.optional &&
    tag.arguments.length === IMPORTED_NATIVE_CONTROL_SINGLE_COUNT
  ) {
    provider = stripParenExpression(tag.callee);
    const target = stripParenExpression(tag.arguments[0]);
    if (isNodeOfType(target, "Literal") && typeof target.value === "string") host = target.value;
  } else return null;
  if (!isNodeOfType(provider, "Identifier") || (host !== "button" && host !== "form")) return null;
  const symbol = module.scopes.symbolFor(provider);
  const imported = getImportBindingForName(module.program, provider.name);
  return symbol?.kind === "import" &&
    imported?.source === "styled-components" &&
    imported.exportedName === "default" &&
    !imported.isNamespace &&
    hasReadonlyAsyncEventBinding(symbol, module)
    ? host
    : null;
};

const readSelectedBoolean = (
  name: string,
  props: ReadonlyMap<string, NativeControlProp>,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean | null => {
  const selected = getAuthoritativeJsxAttribute(opening.attributes, name);
  if (selected) {
    if (!selected.value) return true;
    return isNodeOfType(selected.value, "JSXExpressionContainer")
      ? readStaticBoolean(selected.value.expression)
      : null;
  }
  return readStaticBoolean(props.get(name)?.defaultValue);
};

const readPropName = (
  node: EsTreeNode,
  props: ReadonlyMap<string, NativeControlProp>,
  scopes: ScopeAnalysis,
): string | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  for (const [name, prop] of props) if (prop.symbol === symbol) return name;
  return null;
};

const readHostName = (
  node: EsTreeNode,
  props: ReadonlyMap<string, NativeControlProp>,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  module: AsyncEventSourceModule,
  visited: Set<SymbolDescriptor> = new Set(),
): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string")
    return expression.value;
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const name = readPropName(expression.test, props, module.scopes);
    return name && readSelectedBoolean(name, props, opening) === false
      ? readHostName(expression.alternate, props, opening, module, visited)
      : null;
  }
  if (!isNodeOfType(expression, "Identifier") && !isNodeOfType(expression, "JSXIdentifier"))
    return null;
  const symbol = module.scopes.symbolFor(expression);
  if (
    !symbol ||
    visited.has(symbol) ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !hasReadonlyAsyncEventBinding(symbol, module)
  )
    return null;
  visited.add(symbol);
  const allowed = new Set<EsTreeNode>();
  for (const reference of symbol.references) {
    const parent = reference.identifier.parent;
    if (
      (!isNodeOfType(parent, "JSXOpeningElement") && !isNodeOfType(parent, "JSXClosingElement")) ||
      parent.name !== reference.identifier
    )
      return null;
    allowed.add(reference.identifier);
  }
  return hasClosedReads(symbol, allowed, module)
    ? readHostName(symbol.initializer, props, opening, module, visited)
    : null;
};

export const resolveImportedNativeControlEventProp = ({
  attribute,
  context,
}: ResolveImportedNativeControlEventPropInput): EsTreeNode | null => {
  const filename = context.filename;
  const opening = attribute.parent;
  const eventName = getJsxAttributeName(attribute.name);
  if (
    !filename ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    (eventName !== "onClick" && eventName !== "onSubmit") ||
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  )
    return null;
  if (
    opening.attributes.some((item) => !isNodeOfType(item, "JSXAttribute")) ||
    opening.attributes.filter(
      (item) => isNodeOfType(item, "JSXAttribute") && getJsxAttributeName(item.name) === eventName,
    ).length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
    getAuthoritativeJsxAttribute(opening.attributes, eventName) !== attribute
  )
    return null;
  const caller: AsyncEventSourceModule = {
    filename: path.resolve(filename),
    program: context.scopes.rootScope.node,
    scopes: context.scopes,
  };
  const selectedSymbol = caller.scopes.symbolFor(opening.name);
  const binding = getImportBindingForName(opening, opening.name.name);
  if (
    !selectedSymbol ||
    selectedSymbol.kind !== "import" ||
    !binding ||
    binding.isNamespace ||
    binding.exportedName === null ||
    !hasClosedComponentBinding(selectedSymbol, caller)
  )
    return null;
  try {
    const resolved = resolveControlValueExport(
      caller.filename,
      binding.source,
      binding.exportedName,
    );
    if (!resolved?.contexts?.length) return null;
    const modules = resolved.contexts.map((entry) => ({
      filename: entry.filePath,
      program: entry.programNode,
      scopes: analyzeScopes(entry.programNode),
    }));
    modules.push(caller);
    if (!modules.every(hasOrdinaryReactSource)) return null;
    const definition = modules.find((module) => module.program === resolved.programNode);
    const factory = stripParenExpression(resolved.exportedNode);
    if (definition && isNodeOfType(factory, "TaggedTemplateExpression")) {
      const hostName = readPlainStyledControlHost(factory, definition);
      if (
        hostName !== (eventName === "onClick" ? "button" : "form") ||
        !modules.every(hasClosedPlainStyledProviders)
      )
        return null;
      if (
        [...IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES, "ref"].some((name) =>
          getAuthoritativeJsxAttribute(opening.attributes, name),
        )
      )
        return null;
      if (
        getAuthoritativeJsxAttribute(opening.attributes, "disabled") &&
        readSelectedBoolean("disabled", new Map<string, NativeControlProp>(), opening) !== false
      )
        return null;
      const symbols = getFunctionBindingSymbols(factory, definition.scopes);
      if (
        symbols.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
        !hasClosedComponentBinding(symbols[0], definition)
      )
        return null;
      const declaration = symbols[0].declarationNode;
      if (
        !isNodeOfType(declaration, "VariableDeclarator") ||
        !isNodeOfType(declaration.parent, "VariableDeclaration") ||
        declaration.parent.kind !== "const" ||
        !declaration.init ||
        stripParenExpression(declaration.init) !== factory ||
        !hasClosedImportedControlAliases({ modules, resolved })
      )
        return null;
      return attribute.value.expression;
    }
    if (
      !definition ||
      !isNodeOfType(factory, "CallExpression") ||
      factory.optional ||
      factory.arguments.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
      !isProvenUnmodifiedReactApiCall(factory, "forwardRef", definition.scopes)
    )
      return null;
    const render = unwrapProvenReactHocFunction(factory, definition.scopes);
    if (
      !render ||
      !isFunctionLike(render) ||
      render.async ||
      render.generator ||
      render.params.length !== IMPORTED_NATIVE_CONTROL_RENDER_PARAMETER_COUNT
    )
      return null;
    if (!isFunctionLike(stripParenExpression(factory.arguments[0]))) return null;
    const componentSymbols = getFunctionBindingSymbols(factory, definition.scopes);
    if (
      componentSymbols.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
      !hasClosedComponentBinding(componentSymbols[0], definition)
    )
      return null;
    for (const symbol of getFunctionBindingSymbols(render, definition.scopes)) {
      if (symbol !== componentSymbols[0] && !hasClosedReads(symbol, new Set(), definition))
        return null;
    }
    const componentDeclaration = componentSymbols[0].declarationNode;
    if (
      !isNodeOfType(componentDeclaration, "VariableDeclarator") ||
      !isNodeOfType(componentDeclaration.parent, "VariableDeclaration") ||
      componentDeclaration.parent.kind !== "const" ||
      !componentDeclaration.init ||
      stripParenExpression(componentDeclaration.init) !== factory
    )
      return null;
    if (!hasClosedImportedControlAliases({ modules, resolved })) return null;
    const [pattern, forwardedRef] = render.params;
    if (!isNodeOfType(pattern, "ObjectPattern") || !isNodeOfType(forwardedRef, "Identifier"))
      return null;
    const props = new Map<string, NativeControlProp>();
    let rest: SymbolDescriptor | null = null;
    for (const property of pattern.properties) {
      if (isNodeOfType(property, "RestElement")) {
        if (rest || !isNodeOfType(property.argument, "Identifier")) return null;
        rest = definition.scopes.symbolFor(property.argument);
        continue;
      }
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      )
        return null;
      const name = getStaticPropertyKeyName(property);
      const target = isNodeOfType(property.value, "AssignmentPattern")
        ? property.value.left
        : property.value;
      const defaultValue = isNodeOfType(property.value, "AssignmentPattern")
        ? property.value.right
        : null;
      if (
        !name ||
        props.has(name) ||
        name === "__proto__" ||
        isEventHandlerName(name) ||
        !isNodeOfType(target, "Identifier")
      )
        return null;
      const symbol = definition.scopes.symbolFor(target);
      if (!symbol || !hasReadonlyAsyncEventBinding(symbol, definition)) return null;
      props.set(name, { symbol, defaultValue });
    }
    if (!rest) return null;
    for (const name of IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES) {
      const selected = getAuthoritativeJsxAttribute(opening.attributes, name);
      if ((selected || props.has(name)) && readSelectedBoolean(name, props, opening) !== false)
        return null;
    }
    if (getAuthoritativeJsxAttribute(opening.attributes, "ref")) return null;
    let returned: EsTreeNode = render.body;
    if (isNodeOfType(returned, "BlockStatement")) {
      const last = returned.body.at(-1);
      if (
        !isNodeOfType(last, "ReturnStatement") ||
        !last.argument ||
        returned.body
          .slice(0, -1)
          .some(
            (statement) =>
              !isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const",
          )
      )
        return null;
      returned = last.argument;
    }
    const element = stripParenExpression(returned);
    if (!isNodeOfType(element, "JSXElement")) return null;
    const host = element.openingElement;
    if (!isNodeOfType(host.name, "JSXIdentifier")) return null;
    const hostName =
      host.name.name === "button" || host.name.name === "form"
        ? host.name.name
        : readHostName(host.name, props, opening, definition);
    if (hostName !== (eventName === "onClick" ? "button" : "form")) return null;
    const spreads = host.attributes.filter((item) => isNodeOfType(item, "JSXSpreadAttribute"));
    if (
      spreads.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
      !isNodeOfType(spreads[0], "JSXSpreadAttribute") ||
      !isNodeOfType(spreads[0].argument, "Identifier") ||
      definition.scopes.symbolFor(spreads[0].argument) !== rest ||
      !hasClosedReads(rest, new Set([spreads[0].argument]), definition)
    )
      return null;
    if (
      host.attributes.some(
        (item) =>
          isNodeOfType(item, "JSXAttribute") &&
          (isEventHandlerName(getJsxAttributeName(item.name) ?? "") ||
            IMPORTED_NATIVE_CONTROL_POLYMORPHIC_PROP_NAMES.has(
              getJsxAttributeName(item.name) ?? "",
            )),
      )
    )
      return null;
    const ref = getAuthoritativeJsxAttribute(
      host.attributes.filter((item) => !isNodeOfType(item, "JSXSpreadAttribute")),
      "ref",
    );
    const refValue = ref?.value;
    const refSymbol = definition.scopes.symbolFor(forwardedRef);
    if (
      !refSymbol ||
      !refValue ||
      !isNodeOfType(refValue, "JSXExpressionContainer") ||
      !isNodeOfType(refValue.expression, "Identifier") ||
      definition.scopes.symbolFor(refValue.expression) !== refSymbol ||
      !hasClosedReads(refSymbol, new Set([refValue.expression]), definition)
    )
      return null;
    const disabled = getAuthoritativeJsxAttribute(
      host.attributes.filter((item) => !isNodeOfType(item, "JSXSpreadAttribute")),
      "disabled",
    );
    const disabledProp = props.get("disabled");
    if (
      disabledProp?.defaultValue &&
      readStaticBoolean(disabledProp.defaultValue) !== false &&
      readSelectedBoolean("disabled", props, opening) !== false
    )
      return null;
    if (
      getAuthoritativeJsxAttribute(opening.attributes, "disabled") &&
      readSelectedBoolean("disabled", props, opening) === true
    )
      return null;
    if (disabled) {
      if (!disabled.value || !isNodeOfType(disabled.value, "JSXExpressionContainer")) return null;
      const expression = stripParenExpression(disabled.value.expression);
      const isCallerDisabled = (node: EsTreeNode): boolean =>
        readPropName(node, props, definition.scopes) === "disabled";
      if (!isCallerDisabled(expression)) {
        if (!isNodeOfType(expression, "LogicalExpression") || expression.operator !== "||")
          return null;
        const other = isCallerDisabled(expression.left)
          ? expression.right
          : isCallerDisabled(expression.right)
            ? expression.left
            : null;
        const otherName = other ? readPropName(other, props, definition.scopes) : null;
        if (!otherName || readSelectedBoolean(otherName, props, opening) !== false) return null;
      }
    } else if (disabledProp) return null;
    return attribute.value.expression;
  } catch {
    return null;
  }
};
