import type { EsTreeNode } from "./es-tree-node.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { getStableLexicalBindingValue } from "./get-stable-lexical-binding-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveVerifiedViteExport } from "./resolve-verified-vite-export.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface BoundValue {
  readonly module: NamedViteSourceModule;
  readonly node: EsTreeNode;
}
export interface OwnedReactContext {
  readonly getter: BoundValue;
  readonly context: BoundValue;
  readonly provider: BoundValue;
  readonly value: BoundValue;
  readonly memo: EsTreeNode;
}
const resolveBinding = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  input: EsTreeNode,
): BoundValue | null => {
  const node = stripParenExpression(input);
  if (!isNodeOfType(node, "Identifier")) return { module, node };
  const symbol = module.scopes.symbolFor(node);
  if (!symbol) return null;
  if (symbol.kind === "import") {
    const imported = resolveImportedApiReference(node, module.scopes);
    if (!imported?.importedName || imported.isNamespace) return null;
    const result = resolveVerifiedViteExport(
      project,
      module,
      imported.source,
      imported.importedName,
    );
    return result ? { module: result.module, node: result.exportedNode } : null;
  }
  const value = getStableLexicalBindingValue(symbol, module.scopes);
  return value ? { module, node: value } : null;
};
const equal = (left: BoundValue | null, right: BoundValue | null) =>
  Boolean(left && right && left.module === right.module && left.node === right.node);
const react = (module: NamedViteSourceModule, node: EsTreeNode, name: string) => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    node.callee.optional ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== name
  )
    return false;
  if (
    !isNodeOfType(node.callee.object, "Identifier") ||
    module.scopes.symbolFor(node.callee.object)?.kind !== "import"
  )
    return false;
  const imported = resolveImportedApiReference(node.callee.object, module.scopes);
  return imported?.source === "react" && imported.isNamespace;
};
const sameLocal = (module: NamedViteSourceModule, a: EsTreeNode, b: EsTreeNode) => {
  const symbol = module.scopes.symbolFor(a);
  return Boolean(symbol && symbol === module.scopes.symbolFor(b));
};

// Lexical graph proof; the caller supplies the closed, verified compiler graph.
// Does not certify ambient APIs, mutable React exports or runtime invocation order.
export interface ResolvedContextGetter {
  readonly module: NamedViteSourceModule;
  readonly exportedNode: EsTreeNode;
}

export interface OwnedReactContextDefinition {
  readonly getter: BoundValue;
  readonly context: BoundValue;
  readonly provider: BoundValue;
  readonly valueExpression: EsTreeNode;
}

type OwnedContextGetterUse = (module: NamedViteSourceModule, call: EsTreeNode) => boolean;

const isDirectNamedContextDestructure: OwnedContextGetterUse = (_module, call) => {
  const owner = call.parent;
  return (
    isNodeOfType(owner, "VariableDeclarator") &&
    owner.init === call &&
    isNodeOfType(owner.id, "ObjectPattern") &&
    owner.id.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        isNodeOfType(property.value, "Identifier"),
    )
  );
};

// Only the third parameter may carry an existing React Context. The returned
// hook reads its value without publishing or mutating the Context object.
export const isClosedReactContextGetterFactory = (factory: BoundValue | null): boolean => {
  if (
    !factory ||
    !isNodeOfType(factory.node, "FunctionDeclaration") ||
    factory.node.async ||
    factory.node.generator ||
    factory.node.params.length !== 3 ||
    !isNodeOfType(factory.node.params[2], "Identifier") ||
    !factory.node.body ||
    factory.node.body.body.length !== 1
  )
    return false;
  const factoryReturn = factory.node.body.body[0];
  if (
    !isNodeOfType(factoryReturn, "ReturnStatement") ||
    !isNodeOfType(factoryReturn.argument, "ArrowFunctionExpression") ||
    factoryReturn.argument.async ||
    factoryReturn.argument.params.length ||
    !isNodeOfType(factoryReturn.argument.body, "BlockStatement") ||
    factoryReturn.argument.body.body.length !== 3
  )
    return false;
  const [assign, guard, result] = factoryReturn.argument.body.body;
  if (
    !isNodeOfType(assign, "VariableDeclaration") ||
    assign.kind !== "const" ||
    assign.declarations.length !== 1 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(result, "ReturnStatement") ||
    !result.argument
  )
    return false;
  const local = assign.declarations[0];
  if (
    !isNodeOfType(local.id, "Identifier") ||
    !local.init ||
    !react(factory.module, local.init, "useContext") ||
    !isNodeOfType(local.init, "CallExpression") ||
    local.init.arguments.length !== 1 ||
    !sameLocal(factory.module, local.init.arguments[0], factory.node.params[2]) ||
    !sameLocal(factory.module, result.argument, local.id) ||
    !isNodeOfType(guard.test, "UnaryExpression") ||
    guard.test.operator !== "!" ||
    !sameLocal(factory.module, guard.test.argument, local.id) ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== 1 ||
    !isNodeOfType(guard.consequent.body[0], "ThrowStatement")
  )
    return false;
  const contextParam = factory.module.scopes.symbolFor(factory.node.params[2]);
  const selectedContext = local.init.arguments[0];
  return Boolean(
    contextParam &&
    contextParam.references.length === 1 &&
    contextParam.references[0]?.flag === "read" &&
    contextParam.references[0].identifier === selectedContext,
  );
};

export const readOwnedReactContextDefinition = (
  project: NamedViteSourceProject,
  resolved: ResolvedContextGetter,
  acceptsRead: OwnedContextGetterUse,
): OwnedReactContextDefinition | null => {
  // Caches are invocation-local and never survive a project or AST replacement.
  const byModule = new Map<NamedViteSourceModule, Map<number, BoundValue | null>>();
  const binding = (
    project: NamedViteSourceProject,
    module: NamedViteSourceModule,
    node: EsTreeNode,
  ): BoundValue | null => {
    const symbol = isNodeOfType(node, "Identifier") ? module.scopes.symbolFor(node) : null;
    if (!symbol) return resolveBinding(project, module, node);
    let cached = byModule.get(module);
    if (!cached) {
      cached = new Map();
      byModule.set(module, cached);
    }
    if (!cached.has(symbol.id)) cached.set(symbol.id, resolveBinding(project, module, node));
    return cached.get(symbol.id) ?? null;
  };
  const getter: BoundValue = {
    module: resolved.module,
    node: stripParenExpression(resolved.exportedNode),
  };
  if (
    project.modulesByFilePath.get(getter.module.filePath) !== getter.module ||
    !isNodeOfType(getter.node, "CallExpression") ||
    getter.node.optional ||
    getter.node.arguments.length !== 3
  )
    return null;
  const getterCreation = getter.node;
  const factory = binding(project, getter.module, getterCreation.callee);
  if (!isClosedReactContextGetterFactory(factory)) return null;
  const context = binding(project, getter.module, getterCreation.arguments[2]);
  if (
    !context ||
    !react(context.module, context.node, "createContext") ||
    !isNodeOfType(context.node, "CallExpression") ||
    context.node.arguments.length !== 1 ||
    !isNodeOfType(context.node.arguments[0], "Literal") ||
    context.node.arguments[0].value !== null
  )
    return null;
  const jsxBinding = (module: NamedViteSourceModule, node: EsTreeNode): BoundValue | null => {
    if (!isNodeOfType(node, "JSXIdentifier")) return null;
    let scope = module.scopes.scopeFor(node);
    while (scope) {
      const symbol = scope.symbols.find((symbol) => symbol.name === node.name);
      if (symbol) return binding(project, module, symbol.bindingIdentifier);
      if (!scope.parent) break;
      scope = scope.parent;
    }
    return null;
  };
  const providers: BoundValue[] = [];
  let escaped = false;
  for (const module of project.modulesByFilePath.values()) {
    // Local namespace imports can enumerate or hide context aliases. React's
    // verified namespace is supported, but a local module namespace is refused.
    for (const statement of module.programNode.body) {
      if (!isNodeOfType(statement, "ImportDeclaration") || statement.importKind === "type")
        continue;
      if (
        statement.specifiers.some((specifier) =>
          isNodeOfType(specifier, "ImportNamespaceSpecifier"),
        ) &&
        typeof statement.source.value === "string" &&
        module.localImports.has(statement.source.value)
      )
        return null;
    }
    walkAst(module.programNode, (node) => {
      if (isNodeOfType(node, "JSXIdentifier") && equal(jsxBinding(module, node), getter)) {
        escaped = true;
        return;
      }
      if (isNodeOfType(node, "JSXIdentifier") && equal(jsxBinding(module, node), context)) {
        const member = node.parent;
        const tag = member?.parent;
        if (
          !isNodeOfType(member, "JSXMemberExpression") ||
          member.object !== node ||
          member.property.name !== "Provider" ||
          (!isNodeOfType(tag, "JSXOpeningElement") && !isNodeOfType(tag, "JSXClosingElement")) ||
          tag.name !== member
        )
          escaped = true;
        return;
      }
      if (!isNodeOfType(node, "Identifier")) return;
      if (equal(binding(project, module, node), getter)) {
        const parent = node.parent;
        if (isNodeOfType(parent, "VariableDeclarator") && parent.id === node) return;
        if (isNodeOfType(parent, "ImportSpecifier") || isNodeOfType(parent, "ExportSpecifier"))
          return;
        if (
          !isNodeOfType(parent, "CallExpression") ||
          parent.callee !== node ||
          parent.optional ||
          parent.arguments.length ||
          !acceptsRead(module, parent)
        )
          escaped = true;
        return;
      }
      if (!equal(binding(project, module, node), context)) return;
      const parent = node.parent;
      if (!parent) {
        escaped = true;
        return;
      }
      if (
        (isNodeOfType(parent, "VariableDeclarator") && parent.id === node) ||
        isNodeOfType(parent, "ImportSpecifier") ||
        isNodeOfType(parent, "ExportSpecifier")
      )
        return;
      if (module === getter.module && node === getterCreation.arguments[2]) return;
      // OXC's JSXMemberExpression uses JSXIdentifier leaves, scanned below.
      escaped = true;
    });
    walkAst(module.programNode, (node) => {
      if (
        !isNodeOfType(node, "JSXElement") ||
        !isNodeOfType(node.openingElement.name, "JSXMemberExpression") ||
        node.openingElement.name.property.name !== "Provider"
      )
        return;
      const object = node.openingElement.name.object;
      if (!isNodeOfType(object, "JSXIdentifier") || !equal(jsxBinding(module, object), context))
        return;
      providers.push({ module, node });
    });
  }
  if (escaped || providers.length !== 1) return null;
  const provider = providers[0];
  if (!isNodeOfType(provider.node, "JSXElement")) return null;
  const attributes = provider.node.openingElement.attributes;
  if (
    attributes.length !== 1 ||
    !isNodeOfType(attributes[0], "JSXAttribute") ||
    attributes[0].name.name !== "value" ||
    !isNodeOfType(attributes[0].value, "JSXExpressionContainer") ||
    !attributes[0].value.expression
  )
    return null;
  return { getter, context, provider, valueExpression: attributes[0].value.expression };
};

export const resolveOwnedReactContextFromGetter = (
  project: NamedViteSourceProject,
  resolved: ResolvedContextGetter,
): OwnedReactContext | null => {
  const definition = readOwnedReactContextDefinition(
    project,
    resolved,
    isDirectNamedContextDestructure,
  );
  if (!definition) return null;
  const { getter, context, provider, valueExpression: providerValueExpression } = definition;
  const value = resolveBinding(project, provider.module, providerValueExpression);
  if (
    !value ||
    !react(value.module, value.node, "useMemo") ||
    !isNodeOfType(value.node, "CallExpression") ||
    !isNodeOfType(value.node.arguments[0], "ArrowFunctionExpression")
  )
    return null;
  let valueEscapes = false;
  walkAst(value.module.programNode, (node) => {
    if (
      !isNodeOfType(node, "Identifier") ||
      !equal(resolveBinding(project, value.module, node), value)
    )
      return;
    if (isNodeOfType(node.parent, "VariableDeclarator") && node.parent.id === node) return;
    if (node === providerValueExpression) return;
    valueEscapes = true;
  });
  if (valueEscapes) return null;
  return { getter, context, provider, value, memo: value.node.arguments[0] };
};
