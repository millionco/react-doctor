import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { StaticCssWriterModule } from "./read-static-css-writer-module.js";

interface SelectedCssTokenInput {
  readonly property: string;
  readonly relativeFile: string;
}

const sameBinding = (node: EsTreeNode, target: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && scopes.symbolFor(node)?.id === target.id;

const isLiteral = (node: EsTreeNode | undefined | null, value: string): boolean =>
  isNodeOfType(node, "Literal") && node.value === value;

const directMember = (
  node: EsTreeNode,
  name: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === name;

const directCall = (
  node: EsTreeNode | null | undefined,
  count: number,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") && !node.optional && node.arguments.length === count;

const readPathBinding = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const selected = program.body.flatMap((statement) =>
    isNodeOfType(statement, "ImportDeclaration") && statement.source.value === "node:path"
      ? statement.specifiers.filter((specifier) =>
          isNodeOfType(specifier, "ImportDefaultSpecifier"),
        )
      : [],
  );
  return selected.length === 1 ? (scopes.symbolFor(selected[0]!.local) ?? null) : null;
};

const isLiteralFileUrlHelper = (
  descriptor: SymbolDescriptor,
  pathBinding: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const node = descriptor.declarationNode;
  if (
    !isNodeOfType(node, "FunctionDeclaration") ||
    node.async ||
    node.generator ||
    node.params.length !== 1 ||
    !isNodeOfType(node.params[0], "Identifier") ||
    !node.body ||
    node.body.body.length !== 1
  )
    return false;
  const pathParameter = scopes.symbolFor(node.params[0]);
  const statement = node.body.body[0];
  if (
    !pathParameter ||
    !isNodeOfType(statement, "ReturnStatement") ||
    !isNodeOfType(statement.argument, "BinaryExpression") ||
    statement.argument.operator !== "+" ||
    !isLiteral(statement.argument.left, "file:///") ||
    !directCall(statement.argument.right, 1)
  )
    return false;
  const join = statement.argument.right;
  if (
    !directMember(join.callee, "join") ||
    !isLiteral(join.arguments[0], "/") ||
    !directCall(join.callee.object, 1)
  )
    return false;
  const split = join.callee.object;
  const separator = split.arguments[0];
  return (
    directMember(split.callee, "split") &&
    sameBinding(split.callee.object, pathParameter, scopes) &&
    Boolean(
      separator &&
      directMember(separator, "sep") &&
      sameBinding(separator.object, pathBinding, scopes),
    )
  );
};

const readPathDeclarations = (
  writer: StaticCssWriterModule,
  pathBinding: SymbolDescriptor,
  scopes: ScopeAnalysis,
): ReadonlyMap<SymbolDescriptor, string> | null => {
  const byBinding = new Map<SymbolDescriptor, string>();
  const remaining = new Set(writer.inputRelativeFiles);
  for (const symbol of scopes.rootScope.symbols.values()) {
    const { declarationNode } = symbol;
    if (
      !isNodeOfType(declarationNode, "VariableDeclarator") ||
      !isNodeOfType(declarationNode.init, "CallExpression") ||
      declarationNode.init.optional ||
      !directMember(declarationNode.init.callee, "join") ||
      !sameBinding(declarationNode.init.callee.object, pathBinding, scopes)
    )
      continue;
    const parts = declarationNode.init.arguments.slice(1);
    if (!parts.every((part) => isNodeOfType(part, "Literal") && typeof part.value === "string"))
      continue;
    const relative = parts
      .map((part) => (isNodeOfType(part, "Literal") ? part.value : ""))
      .join("/");
    if (!writer.inputRelativeFiles.includes(relative)) continue;
    if (!remaining.delete(relative)) return null;
    byBinding.set(symbol, relative);
  }
  return remaining.size === 0 ? byBinding : null;
};

const readImportSource = (
  node: EsTreeNode | null | undefined,
  pathBinding: SymbolDescriptor,
  byBinding: ReadonlyMap<SymbolDescriptor, string>,
  scopes: ScopeAnalysis,
): string | null => {
  if (
    !isNodeOfType(node, "AwaitExpression") ||
    !isNodeOfType(node.argument, "ImportExpression") ||
    node.argument.options != null ||
    !isNodeOfType(node.argument.source, "TemplateLiteral")
  )
    return null;
  const { expressions, quasis } = node.argument.source;
  if (
    expressions.length !== 2 ||
    quasis.length !== 3 ||
    quasis[0]?.value.cooked !== "" ||
    quasis[1]?.value.cooked !== "?t=" ||
    quasis[2]?.value.cooked !== ""
  )
    return null;
  const [url, timestamp] = expressions;
  if (
    !directCall(url, 1) ||
    !isNodeOfType(url.callee, "Identifier") ||
    !directCall(timestamp, 0) ||
    !directMember(timestamp.callee, "now") ||
    !isNodeOfType(timestamp.callee.object, "Identifier") ||
    timestamp.callee.object.name !== "Date" ||
    !scopes.isGlobalReference(timestamp.callee.object)
  )
    return null;
  const argument = url.arguments[0];
  const helper = scopes.symbolFor(url.callee);
  const input = isNodeOfType(argument, "Identifier") ? scopes.symbolFor(argument) : null;
  return helper && input && isLiteralFileUrlHelper(helper, pathBinding, scopes)
    ? (byBinding.get(input) ?? null)
    : null;
};

export const readBoundedCssTokenInputs = (
  program: EsTreeNode,
  writer: StaticCssWriterModule,
  scopes: ScopeAnalysis,
): readonly SelectedCssTokenInput[] | null => {
  if (!isNodeOfType(program, "Program")) return null;
  const pathBinding = readPathBinding(program, scopes);
  const loader = writer.producer.declarationNode;
  if (
    !pathBinding ||
    !isNodeOfType(loader, "FunctionDeclaration") ||
    !loader.async ||
    loader.generator ||
    loader.params.length !== 0 ||
    !loader.body ||
    loader.body.body.length !== writer.inputRelativeFiles.length + 1
  )
    return null;
  const inputs = readPathDeclarations(writer, pathBinding, scopes);
  if (!inputs) return null;
  const declared = new Map<SymbolDescriptor, string>();
  const consumedFiles = new Set<string>();
  for (const statement of loader.body.body.slice(0, -1)) {
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.declarations.length !== 1
    )
      return null;
    const local = statement.declarations[0];
    if (!isNodeOfType(local?.id, "Identifier")) return null;
    const symbol = scopes.symbolFor(local.id);
    const relativeFile = readImportSource(local.init, pathBinding, inputs, scopes);
    if (!symbol || !relativeFile || consumedFiles.has(relativeFile)) return null;
    declared.set(symbol, relativeFile);
    consumedFiles.add(relativeFile);
  }
  const last = loader.body.body.at(-1);
  if (
    !isNodeOfType(last, "ReturnStatement") ||
    !isNodeOfType(last.argument, "ObjectExpression") ||
    last.argument.properties.length !== declared.size
  )
    return null;
  const selected: SelectedCssTokenInput[] = [];
  const seenProperties = new Set<string>();
  for (const entry of last.argument.properties) {
    if (
      !isNodeOfType(entry, "Property") ||
      entry.computed ||
      entry.method ||
      entry.kind !== "init" ||
      !isNodeOfType(entry.value, "Identifier")
    )
      return null;
    const property = getStaticPropertyKeyName(entry);
    const symbol = scopes.symbolFor(entry.value);
    const relativeFile = symbol ? declared.get(symbol) : null;
    if (
      !property ||
      property === "__proto__" ||
      seenProperties.has(property) ||
      !relativeFile ||
      !symbol
    )
      return null;
    selected.push({ property, relativeFile });
    declared.delete(symbol);
    seenProperties.add(property);
  }
  return selected;
};
