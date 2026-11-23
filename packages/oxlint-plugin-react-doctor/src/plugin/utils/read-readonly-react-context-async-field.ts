import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findExportedValue } from "./find-exported-value.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import type { StockViteBrowserInspection } from "./read-verified-stock-vite-browser-project.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

type Project = Pick<StockViteBrowserInspection, "index" | "closure">;
type Call = EsTreeNodeOfType<"CallExpression">;
type Property = EsTreeNodeOfType<"Property">;
type Opening = EsTreeNodeOfType<"JSXOpeningElement">;
type OwnFields = ReadonlyMap<string, Property>;
type ImportTarget = { readonly module: SourceProjectModule; readonly name: string };
type Provider = { readonly module: SourceProjectModule; readonly opening: Opening };
type ContextRead = { readonly module: SourceProjectModule; readonly call: Call };

interface ContextUses {
  readonly providers: readonly Provider[];
  readonly reads: readonly ContextRead[];
}

export interface ReadonlyReactContextAsyncFieldInput {
  readonly project: Project;
  readonly consumer: SourceProjectModule;
  readonly hookCall: Call;
  readonly field: string;
}

const readSymbol = (module: SourceProjectModule, node: EsTreeNode): SymbolDescriptor | null => {
  const symbol = module.scopes.symbolFor(node);
  return symbol &&
    hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) &&
    symbol.references.every((ref) => ref.flag === "read")
    ? symbol
    : null;
};

const readFunctionBinding = (
  module: SourceProjectModule,
  declaration: EsTreeNodeOfType<"FunctionDeclaration">,
): SymbolDescriptor | null => {
  const id = declaration.id;
  if (!id || declaration.parent?.type !== "ExportNamedDeclaration") return null;
  const outer = module.scopes.rootScope.symbolsByName.get(id.name);
  return outer &&
    outer.declarationNode === declaration &&
    hasCompleteSymbolReferences(outer, module.programNode, module.scopes) &&
    outer.references.every((ref) => ref.flag === "read")
    ? outer
    : null;
};

const directImport = (module: SourceProjectModule, node: EsTreeNode) => {
  const symbol = readSymbol(module, node);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return null;
  const specifier = symbol.declarationNode;
  const declaration = getImportDeclarationForSymbol(symbol);
  if (!declaration || isTypeOnlyImport(declaration) || specifier.importKind === "type") return null;
  const imported = specifier.imported;
  if (!isNodeOfType(imported, "Identifier")) return null;
  return { declaration, name: imported.name };
};

const isStockReactCall = (
  module: SourceProjectModule,
  call: EsTreeNode,
  name: string,
): call is Call => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const imported = directImport(module, call.callee);
  return imported?.name === name && imported.declaration.source.value === "react";
};

const localImport = (
  project: Project,
  module: SourceProjectModule,
  node: EsTreeNode,
): ImportTarget | null => {
  const imported = directImport(module, node);
  if (!imported) return null;
  const file = project.index.resolvedSourcePathByNode.get(imported.declaration);
  if (!file || !project.closure.reachable.has(file)) return null;
  const target = project.index.modulesByFilePath.get(file);
  return target ? { module: target, name: imported.name } : null;
};

const constInitializer = (module: SourceProjectModule, node: EsTreeNode): EsTreeNode | null => {
  const symbol = readSymbol(module, node);
  return symbol?.kind === "const" && symbol.initializer
    ? stripParenExpression(symbol.initializer)
    : null;
};

const plainObject = (expression: EsTreeNode | null): OwnFields | null => {
  if (!expression) return null;
  const object = stripParenExpression(expression);
  if (!isNodeOfType(object, "ObjectExpression")) return null;
  const own = new Map<string, Property>();
  for (const property of object.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
      return null;
    const key = getStaticPropertyKeyName(property);
    if (!key || key === "__proto__" || own.has(key)) return null;
    own.set(key, property);
  }
  return own;
};

const memoObject = (module: SourceProjectModule, node: EsTreeNode) => {
  if (!isStockReactCall(module, node, "useMemo") || node.arguments.length !== 2) return null;
  const [callback, deps] = node.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(deps, "ArrayExpression")
  )
    return null;
  const properties = plainObject(getSingleReturnExpression(callback));
  return properties ? { properties, deps } : null;
};

const namedRuntimeInputs = (
  project: Project,
  target: ImportTarget,
): ReadonlyArray<{
  readonly module: SourceProjectModule;
  readonly binding: SymbolDescriptor;
}> | null => {
  const matches: Array<{ module: SourceProjectModule; binding: SymbolDescriptor }> = [];
  for (const module of project.index.consumerModulesByFilePath.get(target.module.filePath) ?? []) {
    if (!project.closure.reachable.has(module.filePath)) continue;
    let opaque = false;
    walkAst(module.programNode, (node) => {
      if (project.index.resolvedSourcePathByNode.get(node) !== target.module.filePath) return;
      if (!isNodeOfType(node, "ImportDeclaration")) {
        opaque = true;
        return;
      }
      for (const item of node.specifiers) {
        if (!isNodeOfType(item, "ImportSpecifier")) {
          opaque = true;
          continue;
        }
        if (
          item.importKind === "type" ||
          !isNodeOfType(item.imported, "Identifier") ||
          item.imported.name !== target.name
        )
          continue;
        const binding = readSymbol(module, item.local);
        if (!binding) opaque = true;
        else matches.push({ module, binding });
      }
    });
    if (opaque) return null;
  }
  return matches;
};

const readContextUses = (
  project: Project,
  target: ImportTarget,
  requireNull: boolean,
): ContextUses | null => {
  const { module, name } = target;
  const creator = findExportedValue(module.programNode, name);
  if (
    !creator ||
    !isStockReactCall(module, creator, "createContext") ||
    creator.arguments.length !== 1 ||
    (requireNull &&
      (!isNodeOfType(creator.arguments[0], "Literal") || creator.arguments[0].value !== null))
  )
    return null;
  const declaration = creator.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return null;
  const origin = readSymbol(module, declaration.id);
  // The Context lives in a definition-only module. Runtime users import it by a
  // single named binding; namespace access and re-exports need another proof.
  if (
    !origin ||
    origin.kind !== "const" ||
    origin.references.length !== 0 ||
    declaration.parent?.parent?.type !== "ExportNamedDeclaration"
  )
    return null;
  const imported = namedRuntimeInputs(project, target);
  if (!imported) return null;
  const providers: Provider[] = [];
  const reads: ContextRead[] = [];
  for (const item of imported) {
    for (const ref of item.binding.references) {
      const token = ref.identifier;
      const parent = token.parent;
      if (
        parent &&
        isStockReactCall(item.module, parent, "useContext") &&
        parent.arguments.length === 1 &&
        parent.arguments[0] === token
      ) {
        reads.push({ module: item.module, call: parent });
        continue;
      }
      if (
        !isNodeOfType(parent, "JSXMemberExpression") ||
        parent.object !== token ||
        parent.property.name !== "Provider"
      )
        return null;
      const tag = parent.parent;
      if (isNodeOfType(tag, "JSXOpeningElement") && tag.name === parent)
        providers.push({ module: item.module, opening: tag });
      else if (!isNodeOfType(tag, "JSXClosingElement") || tag.name !== parent) return null;
    }
  }
  return { providers, reads };
};

const hasOnlyOwnPatternFields = (pattern: EsTreeNode, own: OwnFields): boolean =>
  isNodeOfType(pattern, "ObjectPattern") &&
  pattern.properties.every((item) => {
    const key = getStaticPropertyKeyName(item);
    return isNodeOfType(item, "Property") && key !== null && own.has(key);
  });

const collectRecordCalls = (
  module: SourceProjectModule,
  binding: SymbolDescriptor,
  own: OwnFields,
  onReturned: (node: EsTreeNode) => boolean,
): ReadonlySet<string> | null => {
  const pending = [binding];
  const seen = new Set<SymbolDescriptor>();
  const calledFields = new Set<string>();
  for (const symbol of pending) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    for (const ref of symbol.references) {
      const node = findTransparentExpressionRoot(ref.identifier);
      const parent = node.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === node &&
        isNodeOfType(parent.parent, "VariableDeclaration") &&
        parent.parent.kind === "const"
      ) {
        if (hasOnlyOwnPatternFields(parent.id, own)) continue;
        if (!isNodeOfType(parent.id, "Identifier")) return null;
        const alias = readSymbol(module, parent.id);
        if (!alias) return null;
        pending.push(alias);
        continue;
      }
      if (
        isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "!" &&
        parent.argument === node
      )
        continue;
      if (isNodeOfType(parent, "ReturnStatement") && parent.argument === node && onReturned(parent))
        continue;
      if (
        isNodeOfType(parent, "ArrayExpression") &&
        parent.elements.some((element) => element === node) &&
        isNodeOfType(parent.parent, "CallExpression") &&
        parent.parent.arguments[1] === parent &&
        (isStockReactCall(module, parent.parent, "useMemo") ||
          isStockReactCall(module, parent.parent, "useCallback") ||
          isStockReactCall(module, parent.parent, "useEffect"))
      )
        continue;
      if (!isNodeOfType(parent, "MemberExpression") || parent.object !== node) return null;
      const key = getStaticPropertyKeyName(parent);
      if (!key || !own.has(key)) return null;
      const read = findTransparentExpressionRoot(parent);
      const use = read.parent;
      if (isNodeOfType(use, "CallExpression") && use.callee === read) {
        calledFields.add(key);
        continue;
      }
      // Do not allow the record as an implicit receiver or as an assignment
      // target. Destructuring assignment adds pattern wrappers around a member.
      let target = read;
      while (
        isNodeOfType(target.parent, "Property") ||
        isNodeOfType(target.parent, "ObjectPattern") ||
        isNodeOfType(target.parent, "ArrayPattern") ||
        isNodeOfType(target.parent, "RestElement") ||
        isNodeOfType(target.parent, "AssignmentPattern")
      )
        target = target.parent;
      const outer = target.parent;
      if (
        (isNodeOfType(outer, "AssignmentExpression") && outer.left === target) ||
        (isNodeOfType(outer, "ForInStatement") && outer.left === target) ||
        (isNodeOfType(outer, "ForOfStatement") && outer.left === target) ||
        (isNodeOfType(outer, "UpdateExpression") && outer.argument === target) ||
        (isNodeOfType(use, "UnaryExpression") &&
          use.operator === "delete" &&
          use.argument === read) ||
        (isNodeOfType(use, "TaggedTemplateExpression") && use.tag === read)
      )
        return null;
    }
  }
  return calledFields;
};

const boundResult = (module: SourceProjectModule, call: Call): SymbolDescriptor | null => {
  const declaration = call.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== call ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return null;
  const binding = readSymbol(module, declaration.id);
  return binding?.kind === "const" ? binding : null;
};

const directArrow = (module: SourceProjectModule, expression: EsTreeNode) => {
  let node = stripParenExpression(expression);
  if (isNodeOfType(node, "Identifier")) {
    const initializer = constInitializer(module, node);
    if (!initializer) return null;
    node = initializer;
  }
  if (
    isStockReactCall(module, node, "useCallback") &&
    node.arguments.length === 2 &&
    isNodeOfType(node.arguments[1], "ArrayExpression")
  )
    node = node.arguments[0];
  return isNodeOfType(node, "ArrowFunctionExpression") ? node : null;
};

const readSelectedArrow = (
  project: Project,
  module: SourceProjectModule,
  expression: EsTreeNode,
) => {
  const local = directArrow(module, expression);
  if (local) return local;
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = readSymbol(module, expression);
  if (!symbol || symbol.kind !== "const") return null;
  const binding = symbol.bindingIdentifier;
  const property = binding.parent;
  if (!isNodeOfType(property, "Property") || property.value !== binding) return null;
  const field = getStaticPropertyKeyName(property);
  const pattern = property.parent;
  if (
    !field ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    !isNodeOfType(pattern.parent, "VariableDeclarator")
  )
    return null;
  const call = pattern.parent.init;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 0)
    return null;
  const imported = localImport(project, module, call.callee);
  const producer = imported && findExportedValue(imported.module.programNode, imported.name);
  if (
    !imported ||
    !producer ||
    !isNodeOfType(producer, "FunctionDeclaration") ||
    producer.async ||
    producer.generator ||
    !producer.id ||
    producer.parent?.type !== "ExportNamedDeclaration"
  )
    return null;
  if (!readFunctionBinding(imported.module, producer)) return null;
  const returns = collectFunctionReturnStatements(producer);
  if (returns.length !== 1 || returns[0].parent !== producer.body) return null;
  const result = plainObject(returns[0].argument ?? null)?.get(field);
  return result ? directArrow(imported.module, result.value) : null;
};

const isDirectlyReturnedProvider = (project: Project, provider: Provider): boolean => {
  const initial = provider.opening.parent;
  if (!isNodeOfType(initial, "JSXElement")) return false;
  let tree: EsTreeNode = initial;
  while (isNodeOfType(tree.parent, "JSXElement") || isNodeOfType(tree.parent, "JSXFragment")) {
    const parent: EsTreeNodeOfType<"JSXElement" | "JSXFragment"> = tree.parent;
    if (!(parent.children as readonly EsTreeNode[]).includes(tree)) return false;
    if (isNodeOfType(parent, "JSXElement")) {
      const tag = parent.openingElement.name;
      if (!isNodeOfType(tag, "JSXMemberExpression") || tag.property.name !== "Provider")
        return false;
      const context = localImport(project, provider.module, tag.object);
      if (
        !context ||
        !readContextUses(project, context, false)?.providers.some(
          (use) => use.module === provider.module && use.opening === parent.openingElement,
        )
      )
        return false;
    }
    tree = parent;
  }
  const rendered = findTransparentExpressionRoot(tree);
  const parent = rendered.parent;
  return (
    isNodeOfType(parent, "ReturnStatement") &&
    parent.argument === rendered &&
    Boolean(findEnclosingFunction(parent))
  );
};

const proveProvider = (project: Project, provider: Provider) => {
  if (!isDirectlyReturnedProvider(project, provider)) return null;
  const [attribute] = provider.opening.attributes;
  if (
    provider.opening.attributes.length !== 1 ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    getJsxAttributeName(attribute.name) !== "value" ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  )
    return null;
  const value = attribute.value.expression;
  if (!isNodeOfType(value, "Identifier")) return null;
  const symbol = readSymbol(provider.module, value);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    symbol.references.length !== 1 ||
    symbol.references[0].identifier !== value ||
    findEnclosingFunction(symbol.declarationNode) !== findEnclosingFunction(provider.opening)
  )
    return null;
  return memoObject(provider.module, symbol.initializer);
};

const checkWholeRecordCallers = (
  project: Project,
  module: SourceProjectModule,
  owner: EsTreeNode,
  own: OwnFields,
  calledFields: Set<string>,
): boolean => {
  if (
    !isNodeOfType(owner, "FunctionDeclaration") ||
    !owner.id ||
    owner.parent?.type !== "ExportNamedDeclaration"
  )
    return false;
  if (readFunctionBinding(module, owner)?.references.length !== 0) return false;
  const callers = namedRuntimeInputs(project, { module, name: owner.id.name });
  if (!callers) return false;
  for (const caller of callers) {
    for (const ref of caller.binding.references) {
      const node = ref.identifier.parent;
      if (!isNodeOfType(node, "CallExpression") || node.optional || node.callee !== ref.identifier)
        return false;
      const result = node.parent;
      if (
        isNodeOfType(result, "VariableDeclarator") &&
        result.init === node &&
        isNodeOfType(result.parent, "VariableDeclaration") &&
        result.parent.kind === "const" &&
        hasOnlyOwnPatternFields(result.id, own)
      )
        continue;
      const binding = boundResult(caller.module, node);
      const read = binding && collectRecordCalls(caller.module, binding, own, () => false);
      if (!read) return false;
      for (const field of read) calledFields.add(field);
    }
  }
  return true;
};

/** Accepts a source witness only inside a verified stock React renderer closure. */
export const readReadonlyReactContextAsyncField = ({
  project,
  consumer,
  hookCall,
  field,
}: ReadonlyReactContextAsyncFieldInput): readonly string[] | null => {
  if (
    !project.closure.reachable.has(consumer.filePath) ||
    hookCall.optional ||
    hookCall.arguments.length !== 0
  )
    return null;
  const imported = localImport(project, consumer, hookCall.callee);
  const hook = imported && findExportedValue(imported.module.programNode, imported.name);
  if (
    !imported ||
    !hook ||
    !isNodeOfType(hook, "FunctionDeclaration") ||
    !readFunctionBinding(imported.module, hook) ||
    !isNodeOfType(hook.body, "BlockStatement") ||
    hook.async ||
    hook.generator ||
    hook.params.length !== 0 ||
    hook.body.body.length !== 3
  )
    return null;
  const [read, guard, result] = hook.body.body;
  if (
    !isNodeOfType(read, "VariableDeclaration") ||
    read.declarations.length !== 1 ||
    !isNodeOfType(read.declarations[0], "VariableDeclarator")
  )
    return null;
  const readCall = read.declarations[0].init;
  if (
    !readCall ||
    !isStockReactCall(imported.module, readCall, "useContext") ||
    readCall.arguments.length !== 1
  )
    return null;
  const binding = boundResult(imported.module, readCall);
  if (
    !binding ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "UnaryExpression") ||
    guard.test.operator !== "!" ||
    imported.module.scopes.symbolFor(guard.test.argument) !== binding ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== 1 ||
    !isNodeOfType(guard.consequent.body[0], "ThrowStatement") ||
    !isNodeOfType(result, "ReturnStatement") ||
    !result.argument
  )
    return null;
  const projected = memoObject(imported.module, result.argument);
  const value = projected?.properties.get(field)?.value;
  if (
    !value ||
    !isNodeOfType(value, "MemberExpression") ||
    value.optional ||
    imported.module.scopes.symbolFor(value.object) !== binding ||
    getStaticPropertyKeyName(value) !== field ||
    !projected?.deps.elements.some(
      (item) =>
        isNodeOfType(item, "MemberExpression") &&
        imported.module.scopes.symbolFor(item.object) === binding &&
        getStaticPropertyKeyName(item) === field,
    )
  )
    return null;

  const context = localImport(project, imported.module, readCall.arguments[0]);
  const uses = context && readContextUses(project, context, true);
  if (
    !context ||
    !uses ||
    uses.providers.length !== 1 ||
    !uses.reads.some(({ call }) => call === readCall)
  )
    return null;
  const [provider] = uses.providers;
  const supplied = proveProvider(project, provider);
  const selected = supplied?.properties.get(field)?.value;
  if (
    !supplied ||
    !selected ||
    !isNodeOfType(selected, "Identifier") ||
    !supplied.deps.elements.some(
      (item) =>
        item &&
        provider.module.scopes.symbolFor(item) === provider.module.scopes.symbolFor(selected),
    ) ||
    !readSelectedArrow(project, provider.module, selected)?.async
  )
    return null;

  const calledFields = new Set<string>();
  for (const access of uses.reads) {
    const local = boundResult(access.module, access.call);
    const owner = findEnclosingFunction(access.call);
    if (!local || !owner) return null;
    const fields = collectRecordCalls(
      access.module,
      local,
      supplied.properties,
      (node) =>
        findEnclosingFunction(node) === owner &&
        checkWholeRecordCallers(project, access.module, owner, supplied.properties, calledFields),
    );
    if (!fields) return null;
    for (const name of fields) calledFields.add(name);
  }
  for (const name of calledFields) {
    const callback = supplied.properties.get(name)?.value;
    if (!callback || !readSelectedArrow(project, provider.module, callback)) return null;
  }
  return [
    consumer.filePath,
    imported.module.filePath,
    context.module.filePath,
    provider.module.filePath,
  ];
};
