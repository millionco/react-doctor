import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { readBarePackageSpecifier } from "./read-bare-package-specifier.js";

export interface StaticAstroVirtualModuleRequirement {
  readonly virtualSource: string;
  readonly manifestSource: string;
  readonly manifestExportName: string;
  readonly idProperty: string;
  readonly prologue: string;
  readonly caseQuasis: readonly [string, string, string];
  readonly epilogue: string;
}

interface IdentifierCall {
  readonly callee: EsTreeNodeOfType<"Identifier">;
  readonly arguments: ReadonlyArray<EsTreeNode>;
}

interface NamedDeclaration {
  readonly symbol: SymbolDescriptor;
  readonly initializer: EsTreeNode | null;
}

interface GuardedHook {
  readonly statements: ReadonlyArray<EsTreeNode>;
  readonly checkedId: EsTreeNode;
}

interface AccumulatorAppend {
  readonly target: EsTreeNode;
  readonly value: EsTreeNode;
}

interface ManifestFieldRead {
  readonly record: EsTreeNode;
  readonly field: string;
}

const VIRTUAL_SOURCE_PATTERN = /^virtual:[a-z0-9._-]+$/u;

const readStringLiteral = (node: EsTreeNode | null | undefined): string | null =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;

const hasExactReferences = (
  symbol: SymbolDescriptor,
  reads: ReadonlyArray<EsTreeNode>,
  appends: ReadonlyArray<EsTreeNode> = [],
): boolean => {
  if (symbol.references.length !== reads.length + appends.length) return false;
  const readNodes = new Set(reads);
  const appendNodes = new Set(appends);
  return symbol.references.every((reference) =>
    reference.flag === "read"
      ? readNodes.has(reference.identifier)
      : reference.flag === "read-write" && appendNodes.has(reference.identifier),
  );
};

const readOwnFields = (
  node: EsTreeNode | undefined,
  names: ReadonlyArray<string>,
): ReadonlyMap<string, EsTreeNodeOfType<"Property">> | null => {
  if (!isNodeOfType(node, "ObjectExpression") || node.properties.length !== names.length)
    return null;
  const expectedFields = new Set(names);
  const fields = new Map<string, EsTreeNodeOfType<"Property">>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.shorthand
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (name === null || !expectedFields.has(name) || fields.has(name)) return null;
    fields.set(name, property);
  }
  return fields;
};

const readFieldValue = (
  fields: ReadonlyMap<string, EsTreeNodeOfType<"Property">>,
  name: string,
): EsTreeNode | undefined => {
  const property = fields.get(name);
  return property && !property.method ? property.value : undefined;
};

const readIdentifierCall = (
  node: EsTreeNode | null | undefined,
  argumentCount: number,
): IdentifierCall | null => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier") ||
    node.arguments.length !== argumentCount
  )
    return null;
  return { callee: node.callee, arguments: node.arguments };
};

const readSingleArrayCall = (node: EsTreeNode | undefined): IdentifierCall | null =>
  isNodeOfType(node, "ArrayExpression") && node.elements.length === 1
    ? readIdentifierCall(node.elements[0], 0)
    : null;

const readSingleRuntimeImport = (symbol: SymbolDescriptor) => {
  const declaration = getImportDeclarationForSymbol(symbol);
  return declaration &&
    !isTypeOnlyImport(declaration) &&
    declaration.specifiers.length === 1 &&
    declaration.specifiers[0] === symbol.declarationNode &&
    !declaration.attributes?.length
    ? declaration
    : null;
};

const isBoundImportCall = (
  call: IdentifierCall,
  scopes: ScopeAnalysis,
  source: string,
  exportedName: string | null,
): boolean => {
  const symbol = scopes.symbolFor(call.callee);
  if (!symbol || !hasExactReferences(symbol, [call.callee])) return false;
  const declaration = readSingleRuntimeImport(symbol);
  return Boolean(
    declaration &&
    declaration.source.value === source &&
    (exportedName === null
      ? isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
      : getImportedName(symbol.declarationNode) === exportedName),
  );
};

const readNamedDeclaration = (
  node: EsTreeNode | undefined,
  kind: "const" | "let",
  scopes: ScopeAnalysis,
): NamedDeclaration | null => {
  if (
    !isNodeOfType(node, "VariableDeclaration") ||
    node.kind !== kind ||
    node.declarations.length !== 1
  )
    return null;
  const declaration = node.declarations[0];
  if (!declaration || !isNodeOfType(declaration.id, "Identifier")) return null;
  const symbol = scopes.symbolFor(declaration.id);
  return symbol?.kind === kind && symbol.declarationNode === declaration
    ? { symbol, initializer: declaration.init }
    : null;
};

const readGuardedHook = (
  property: EsTreeNodeOfType<"Property"> | undefined,
  checkedSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): GuardedHook | null => {
  const hook = property?.value;
  if (
    !property?.method ||
    !isNodeOfType(hook, "FunctionExpression") ||
    hook.async ||
    hook.generator ||
    hook.params.length !== 1 ||
    !isNodeOfType(hook.params[0], "Identifier") ||
    hook.body.body.length !== 2
  )
    return null;
  const parameter = scopes.symbolFor(hook.params[0]);
  const [guard, fallback] = hook.body.body;
  if (
    !parameter ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    !isNodeOfType(guard.test, "BinaryExpression") ||
    guard.test.operator !== "===" ||
    !isNodeOfType(guard.test.left, "Identifier") ||
    scopes.symbolFor(guard.test.left) !== parameter ||
    !hasExactReferences(parameter, [guard.test.left]) ||
    !isNodeOfType(guard.test.right, "Identifier") ||
    scopes.symbolFor(guard.test.right) !== checkedSymbol ||
    !isNodeOfType(fallback, "ReturnStatement") ||
    !isNodeOfType(fallback.argument, "Identifier") ||
    fallback.argument.name !== "undefined" ||
    !scopes.isGlobalReference(fallback.argument)
  )
    return null;
  return { statements: guard.consequent.body, checkedId: guard.test.right };
};

const readAccumulatorAppend = (
  statement: EsTreeNode | undefined,
  accumulator: SymbolDescriptor,
  scopes: ScopeAnalysis,
): AccumulatorAppend | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const assignment = statement.expression;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "+=" ||
    !isNodeOfType(assignment.left, "Identifier") ||
    scopes.symbolFor(assignment.left) !== accumulator
  )
    return null;
  return { target: assignment.left, value: assignment.right };
};

const readManifestField = (
  expression: EsTreeNode | undefined,
  loopItem: SymbolDescriptor,
  scopes: ScopeAnalysis,
): ManifestFieldRead | null => {
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    expression.optional ||
    expression.computed ||
    !isNodeOfType(expression.object, "Identifier") ||
    scopes.symbolFor(expression.object) !== loopItem ||
    !isNodeOfType(expression.property, "Identifier")
  )
    return null;
  return { record: expression.object, field: expression.property.name };
};

const readLoadRequirement = (
  statements: ReadonlyArray<EsTreeNode>,
  virtualSource: string,
  scopes: ScopeAnalysis,
): StaticAstroVirtualModuleRequirement | null => {
  if (statements.length !== 4) return null;
  const [declaration, loop, finalAppend, returned] = statements;
  const accumulator = readNamedDeclaration(declaration, "let", scopes);
  const prologue = readStringLiteral(accumulator?.initializer);
  if (
    !accumulator ||
    prologue === null ||
    !isNodeOfType(loop, "ForOfStatement") ||
    loop.await ||
    !isNodeOfType(loop.right, "Identifier") ||
    !isNodeOfType(loop.body, "BlockStatement") ||
    loop.body.body.length !== 1 ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "Identifier") ||
    scopes.symbolFor(returned.argument) !== accumulator.symbol
  )
    return null;
  const manifest = scopes.symbolFor(loop.right);
  if (!manifest || !hasExactReferences(manifest, [loop.right])) return null;
  const manifestImport = readSingleRuntimeImport(manifest);
  const manifestSource = manifestImport?.source.value;
  const manifestExportName = getImportedName(manifest.declarationNode);
  if (
    typeof manifestSource !== "string" ||
    !readBarePackageSpecifier(manifestSource) ||
    !manifestExportName
  )
    return null;

  const loopItem = readNamedDeclaration(loop.left, "const", scopes);
  const caseAppend = readAccumulatorAppend(loop.body.body[0], accumulator.symbol, scopes);
  const closingAppend = readAccumulatorAppend(finalAppend, accumulator.symbol, scopes);
  const epilogue = readStringLiteral(closingAppend?.value);
  if (
    !loopItem ||
    loopItem.initializer !== null ||
    !caseAppend ||
    !closingAppend ||
    epilogue === null ||
    !isNodeOfType(caseAppend.value, "TemplateLiteral") ||
    caseAppend.value.expressions.length !== 2 ||
    caseAppend.value.quasis.length !== 3 ||
    !hasExactReferences(
      accumulator.symbol,
      [returned.argument],
      [caseAppend.target, closingAppend.target],
    )
  )
    return null;
  const [caseField, importField] = caseAppend.value.expressions;
  const caseRead = readManifestField(caseField, loopItem.symbol, scopes);
  const importRead = readManifestField(importField, loopItem.symbol, scopes);
  const [casePrefix, caseMiddle, caseSuffix] = caseAppend.value.quasis;
  if (
    !caseRead ||
    !importRead ||
    caseRead.field !== importRead.field ||
    !hasExactReferences(loopItem.symbol, [caseRead.record, importRead.record]) ||
    typeof casePrefix?.value.cooked !== "string" ||
    typeof caseMiddle?.value.cooked !== "string" ||
    typeof caseSuffix?.value.cooked !== "string"
  )
    return null;
  return {
    virtualSource,
    manifestSource,
    manifestExportName,
    idProperty: caseRead.field,
    prologue,
    caseQuasis: [casePrefix.value.cooked, caseMiddle.value.cooked, caseSuffix.value.cooked],
    epilogue,
  };
};

const readVirtualFactory = (
  factory: EsTreeNodeOfType<"FunctionDeclaration">,
  scopes: ScopeAnalysis,
): StaticAstroVirtualModuleRequirement | null => {
  if (
    factory.async ||
    factory.generator ||
    factory.params.length !== 0 ||
    factory.body.body.length !== 3
  )
    return null;
  const [publicDeclaration, resolvedDeclaration, returned] = factory.body.body;
  const publicId = readNamedDeclaration(publicDeclaration, "const", scopes);
  const resolvedId = readNamedDeclaration(resolvedDeclaration, "const", scopes);
  const virtualSource = readStringLiteral(publicId?.initializer);
  const resolvedExpression = resolvedId?.initializer;
  if (
    !publicId ||
    !resolvedId ||
    virtualSource === null ||
    !VIRTUAL_SOURCE_PATTERN.test(virtualSource) ||
    !isNodeOfType(resolvedExpression, "BinaryExpression") ||
    resolvedExpression.operator !== "+" ||
    readStringLiteral(resolvedExpression.left) !== "\0" ||
    !isNodeOfType(resolvedExpression.right, "Identifier") ||
    scopes.symbolFor(resolvedExpression.right) !== publicId.symbol ||
    !isNodeOfType(returned, "ReturnStatement")
  )
    return null;
  const plugin = readOwnFields(returned.argument ?? undefined, ["name", "resolveId", "load"]);
  if (!plugin || readStringLiteral(readFieldValue(plugin, "name")) === null) return null;
  const resolver = readGuardedHook(plugin.get("resolveId"), publicId.symbol, scopes);
  const loader = readGuardedHook(plugin.get("load"), resolvedId.symbol, scopes);
  const resolution = resolver?.statements[0];
  if (
    !resolver ||
    !loader ||
    resolver.statements.length !== 1 ||
    !isNodeOfType(resolution, "ReturnStatement") ||
    !isNodeOfType(resolution.argument, "Identifier") ||
    scopes.symbolFor(resolution.argument) !== resolvedId.symbol ||
    !hasExactReferences(publicId.symbol, [resolvedExpression.right, resolver.checkedId]) ||
    !hasExactReferences(resolvedId.symbol, [resolution.argument, loader.checkedId])
  )
    return null;
  return readLoadRequirement(loader.statements, virtualSource, scopes);
};

export const readStaticAstroVirtualModuleRequirement = ({
  programNode,
  scopes,
}: SourceProjectModule): StaticAstroVirtualModuleRequirement | null => {
  if (
    programNode.body.length !== 5 ||
    programNode.body.filter((statement) => isNodeOfType(statement, "ImportDeclaration")).length !==
      3
  )
    return null;
  const exported = programNode.body.find((statement) =>
    isNodeOfType(statement, "ExportDefaultDeclaration"),
  );
  const factory = programNode.body.find((statement) =>
    isNodeOfType(statement, "FunctionDeclaration"),
  );
  if (!exported || !factory || !factory.id) return null;
  const configCall = readIdentifierCall(exported.declaration, 1);
  if (!configCall || !isBoundImportCall(configCall, scopes, "astro/config", "defineConfig"))
    return null;
  const config = readOwnFields(configCall.arguments[0], [
    "base",
    "trailingSlash",
    "integrations",
    "vite",
  ]);
  if (
    !config ||
    readStringLiteral(readFieldValue(config, "base")) === null ||
    readStringLiteral(readFieldValue(config, "trailingSlash")) === null
  )
    return null;
  const integration = readSingleArrayCall(readFieldValue(config, "integrations"));
  const vite = readOwnFields(readFieldValue(config, "vite"), ["plugins"]);
  const pluginCall = vite && readSingleArrayCall(readFieldValue(vite, "plugins"));
  const factorySymbol = pluginCall && scopes.symbolFor(pluginCall.callee);
  if (
    !integration ||
    !isBoundImportCall(integration, scopes, "@astrojs/react", null) ||
    !pluginCall ||
    !factorySymbol ||
    factorySymbol.bindingIdentifier !== factory.id ||
    factorySymbol.declarationNode !== factory ||
    !hasExactReferences(factorySymbol, [pluginCall.callee])
  )
    return null;
  return readVirtualFactory(factory, scopes);
};
