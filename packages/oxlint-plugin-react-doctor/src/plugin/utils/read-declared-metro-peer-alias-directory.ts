import { dirname, join, resolve } from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

type Node = EsTreeNode | null | undefined;

const readObject = (value: Node): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(value, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const property of value.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || name === "__proto__" || result.has(name)) return null;
    result.set(name, property.value);
  }
  return result;
};

const hasOnlyKeys = (value: ReadonlyMap<string, EsTreeNode>, keys: readonly string[]): boolean =>
  [...value.keys()].every((name) => keys.includes(name));

const readString = (node: Node): string | null =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;

const isMember = (node: Node, member: string): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.optional &&
  !node.computed &&
  getStaticPropertyName(node) === member;

const isCall = (node: Node, argumentsCount: number): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === argumentsCount;

const isGlobal = (node: Node, name: string, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);

const isStaticValue = (node: EsTreeNode, depth = 0): boolean => {
  if (depth > 8) return false;
  if (isNodeOfType(node, "Literal"))
    return node.value === null || ["boolean", "number", "string"].includes(typeof node.value);
  if (isNodeOfType(node, "ArrayExpression"))
    return node.elements.every((item) => Boolean(item && isStaticValue(item, depth + 1)));
  const properties = readObject(node);
  return Boolean(
    properties && [...properties.values()].every((item) => isStaticValue(item, depth + 1)),
  );
};

/**
 * Prove a finite Metro alias policy with lexical bindings. This does not
 * evaluate the config, resolve arbitrary factories, or attest Metro itself.
 * The caller must independently prove its selected Metro provider/manifest.
 */
export const readDeclaredMetroPeerAliasDirectory = (
  filename: string,
  peerManifestPath: string,
): string | null => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program") || program.body.length > 12) return null;
  const scopes = analyzeScopes(program);
  const directory = dirname(filename);
  const selectedDeclarations = new Set<EsTreeNode>();

  const readConst = (node: Node): EsTreeNode | null => {
    if (!isNodeOfType(node, "Identifier")) return null;
    const binding = scopes.symbolFor(node);
    const value = binding && getDirectConstInitializer(binding);
    if (!binding || !value || binding.references.some((reference) => reference.flag !== "read"))
      return null;
    selectedDeclarations.add(binding.declarationNode);
    return stripParenExpression(value);
  };

  const readRequired = (node: Node): string | null =>
    isCall(node, 1) && isGlobal(node.callee, "require", scopes)
      ? getGlobalRequireModuleSource(node, scopes)
      : null;

  const isNamedRequire = (node: Node, source: string, importedName: string): boolean => {
    if (!isNodeOfType(node, "Identifier")) return false;
    const binding = scopes.symbolFor(node);
    const declaration = binding?.declarationNode;
    if (
      !binding ||
      binding.kind !== "const" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "ObjectPattern") ||
      declaration.id.properties.length !== 1 ||
      readRequired(declaration.init) !== source
    )
      return false;
    const property = declaration.id.properties[0];
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.value !== binding.bindingIdentifier ||
      getStaticPropertyKeyName(property) !== importedName
    )
      return false;
    const references = binding.references.filter(({ identifier }) => identifier !== property.key);
    if (references.length !== 1 || references[0]?.identifier !== node) return false;
    selectedDeclarations.add(declaration);
    return true;
  };

  const isPathCall = (
    node: Node,
    operation: "join" | "resolve",
    count: number,
  ): node is EsTreeNodeOfType<"CallExpression"> =>
    isCall(node, count) &&
    isMember(node.callee, operation) &&
    ["path", "node:path"].includes(readRequired(readConst(node.callee.object)) ?? "") &&
    isGlobal(node.arguments[0], "__dirname", scopes);

  const exportedStatement = program.body.at(-1);
  const assignment = isNodeOfType(exportedStatement, "ExpressionStatement")
    ? exportedStatement.expression
    : null;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isMember(assignment.left, "exports") ||
    !isGlobal(assignment.left.object, "module", scopes) ||
    !isCall(assignment.right, 1) ||
    !isNamedRequire(assignment.right.callee, "@rnx-kit/metro-config", "makeMetroConfig")
  )
    return null;
  const config = readObject(assignment.right.arguments[0]);
  const resolver = readObject(config?.get("resolver"));
  if (
    !config ||
    !resolver ||
    !hasOnlyKeys(config, ["resolver", "transformer", "watchFolders"]) ||
    !hasOnlyKeys(resolver, ["assetExts", "extraNodeModules", "unstable_enableSymlinks"])
  )
    return null;

  const extra = resolver.get("extraNodeModules");
  if (!isCall(extra, 2) || !isMember(extra.callee, "reduce")) return null;
  const keys = readConst(extra.callee.object) ?? extra.callee.object;
  if (
    !isCall(keys, 1) ||
    !isMember(keys.callee, "keys") ||
    !isGlobal(keys.callee.object, "Object", scopes)
  )
    return null;
  const peers = keys.arguments[0];
  if (!isMember(peers, "peerDependencies")) return null;
  const manifestFile = readRequired(readConst(peers.object) ?? peers.object);
  if (!manifestFile?.startsWith(".") || resolve(directory, manifestFile) !== peerManifestPath)
    return null;

  const [callback, start] = extra.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 2 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    !isNodeOfType(callback.params[1], "Identifier") ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 2 ||
    readObject(start)?.size !== 0
  )
    return null;
  const accumulator = scopes.symbolFor(callback.params[0]);
  const key = scopes.symbolFor(callback.params[1]);
  const [writeStmt, returnStmt] = callback.body.body;
  const write = isNodeOfType(writeStmt, "ExpressionStatement") ? writeStmt.expression : null;
  if (
    !accumulator ||
    !key ||
    !isNodeOfType(write, "AssignmentExpression") ||
    write.operator !== "=" ||
    !isNodeOfType(write.left, "MemberExpression") ||
    !write.left.computed ||
    write.left.optional ||
    scopes.symbolFor(write.left.object) !== accumulator ||
    scopes.symbolFor(write.left.property) !== key ||
    !isPathCall(write.right, "join", 3) ||
    readString(write.right.arguments[1]) !== "node_modules" ||
    !write.right.arguments[2] ||
    scopes.symbolFor(write.right.arguments[2]) !== key ||
    !isNodeOfType(returnStmt, "ReturnStatement") ||
    !returnStmt.argument ||
    scopes.symbolFor(returnStmt.argument) !== accumulator
  )
    return null;

  const assetExts = resolver.get("assetExts");
  if (assetExts) {
    if (!isNodeOfType(assetExts, "ArrayExpression")) return null;
    for (const value of assetExts.elements) {
      if (
        isNodeOfType(value, "SpreadElement") &&
        isMember(value.argument, "assetExts") &&
        isMember(value.argument.object, "resolver")
      ) {
        const base = readConst(value.argument.object.object);
        if (
          !isCall(base, 1) ||
          !isNamedRequire(base.callee, "@react-native/metro-config", "getDefaultConfig") ||
          !isGlobal(base.arguments[0], "__dirname", scopes)
        )
          return null;
        continue;
      }
      if (!/^[A-Za-z0-9]+$/u.test(readString(value) ?? "")) return null;
    }
  }
  const unlink = resolver.get("unstable_enableSymlinks");
  if (unlink && (!isNodeOfType(unlink, "Literal") || typeof unlink.value !== "boolean"))
    return null;

  const watchFolders = config.get("watchFolders");
  if (watchFolders) {
    if (!isNodeOfType(watchFolders, "ArrayExpression") || watchFolders.elements.length !== 1)
      return null;
    const watchedRoot = readConst(watchFolders.elements[0]) ?? watchFolders.elements[0];
    if (!isPathCall(watchedRoot, "resolve", 2)) return null;
    const part = readString(watchedRoot.arguments[1]);
    if (!part?.startsWith(".") || resolve(directory, part) !== dirname(peerManifestPath))
      return null;
  }
  const transform = config.get("transformer");
  if (transform) {
    const fields = readObject(transform);
    const options = fields?.get("getTransformOptions");
    if (
      fields?.size !== 1 ||
      !isNodeOfType(options, "ArrowFunctionExpression") ||
      options.params.length ||
      !isStaticValue(stripParenExpression(options.body))
    )
      return null;
  }

  if (
    !program.body
      .slice(0, -1)
      .every(
        (statement) =>
          isNodeOfType(statement, "VariableDeclaration") &&
          statement.kind === "const" &&
          statement.declarations.every((declaration) => selectedDeclarations.has(declaration)),
      )
  )
    return null;
  return join(directory, "node_modules");
};
