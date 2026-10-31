import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFrozenLiteralExportKind } from "./get-frozen-literal-export-kind.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveRelativeImportPath } from "./resolve-relative-import-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const ENUMERATION_METHOD_NAMES = new Set(["keys", "values", "entries"]);
const UNSAFE_GLOBAL_NAMES = new Set([
  "Array",
  "Reflect",
  "globalThis",
  "global",
  "window",
  "self",
  "eval",
  "Function",
]);
const PROTOTYPE_PROPERTY_NAMES = new Set(["prototype", "__proto__", "constructor"]);

export const createFrozenImportedCollectionChecker = (
  context: RuleContext,
): ((expression: EsTreeNode, collectionKind: "array" | "object") => boolean) => {
  const { scopes } = context;
  const providerBySource = new Map<string, EsTreeNode | null>();
  const kindBySymbolId = new Map<number, "array" | "object" | null>();
  let canUseIntrinsics: boolean | undefined;

  const isEnumerationCall = (node: EsTreeNode | null | undefined): boolean => {
    if (
      !isNodeOfType(node, "CallExpression") ||
      node.optional ||
      node.arguments.length !== 1 ||
      isNodeOfType(node.arguments[0], "SpreadElement")
    ) {
      return false;
    }
    const callee = stripParenExpression(node.callee);
    return (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      !callee.optional &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Object" &&
      scopes.isGlobalReference(callee.object) &&
      ENUMERATION_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
    );
  };

  const hasSafeIntrinsicReferences = (): boolean => {
    if (canUseIntrinsics !== undefined) return canUseIntrinsics;
    canUseIntrinsics = true;
    walkAst(scopes.rootScope.node, (node) => {
      if (!canUseIntrinsics) return false;
      if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
        if (UNSAFE_GLOBAL_NAMES.has(node.name)) canUseIntrinsics = false;
        if (node.name === "Object") {
          const member = findTransparentExpressionRoot(node).parent;
          canUseIntrinsics =
            isNodeOfType(member, "MemberExpression") &&
            isEnumerationCall(findTransparentExpressionRoot(member).parent);
        }
      }
      if (!isNodeOfType(node, "MemberExpression")) return;
      const memberRoot = findTransparentExpressionRoot(node);
      const consumer = memberRoot.parent;
      if (
        PROTOTYPE_PROPERTY_NAMES.has(getStaticPropertyName(node) ?? "") ||
        (isNodeOfType(consumer, "AssignmentExpression") && consumer.left === memberRoot) ||
        (isNodeOfType(consumer, "UpdateExpression") && consumer.argument === memberRoot) ||
        (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "delete")
      ) {
        canUseIntrinsics = false;
      }
    });
    return canUseIntrinsics;
  };

  return (expression, collectionKind) => {
    const candidate = stripParenExpression(expression);
    if (!context.filename || !isNodeOfType(candidate, "Identifier")) return false;
    const originalSymbol = scopes.symbolFor(candidate);
    if (!originalSymbol) return false;
    const cachedKind = kindBySymbolId.get(originalSymbol.id);
    if (cachedKind !== undefined) return cachedKind === collectionKind;
    const pendingSymbols = [originalSymbol];
    const checkedSymbols = new Set<SymbolDescriptor>();
    let importedSymbol: SymbolDescriptor | undefined;
    while (pendingSymbols.length > 0) {
      const symbol = pendingSymbols.pop();
      if (!symbol || checkedSymbols.has(symbol)) continue;
      checkedSymbols.add(symbol);
      if (symbol.kind === "import") {
        if (!isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return false;
        if (importedSymbol && importedSymbol !== symbol) return false;
        importedSymbol = symbol;
      } else {
        if (
          symbol.kind !== "const" ||
          !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
          symbol.declarationNode.id !== symbol.bindingIdentifier ||
          !symbol.initializer
        ) {
          return false;
        }
        const initializer = stripParenExpression(symbol.initializer);
        const sourceSymbol = isNodeOfType(initializer, "Identifier")
          ? scopes.symbolFor(initializer)
          : null;
        if (!sourceSymbol) return false;
        pendingSymbols.push(sourceSymbol);
      }
      for (const reference of symbol.references) {
        if (reference.flag !== "read") return false;
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const consumer = referenceRoot.parent;
        if (
          isNodeOfType(consumer, "VariableDeclarator") &&
          consumer.init === referenceRoot &&
          isNodeOfType(consumer.id, "Identifier")
        ) {
          const aliasSymbol = scopes.symbolFor(consumer.id);
          if (!aliasSymbol) return false;
          pendingSymbols.push(aliasSymbol);
          continue;
        }
        if (isEnumerationCall(consumer)) continue;
        if (!isNodeOfType(consumer, "MemberExpression") || consumer.object !== referenceRoot) {
          return false;
        }
        const methodName = getStaticPropertyName(consumer);
        const call = findTransparentExpressionRoot(consumer).parent;
        if (
          consumer.computed ||
          consumer.optional ||
          (methodName !== "reduce" && methodName !== "reduceRight") ||
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== findTransparentExpressionRoot(consumer) ||
          call.optional ||
          call.arguments.length !== 2 ||
          call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
        ) {
          return false;
        }
      }
    }
    if (!importedSymbol || !hasSafeIntrinsicReferences()) return false;
    const importSpecifier = importedSymbol.declarationNode;
    if (!isNodeOfType(importSpecifier, "ImportSpecifier")) return false;
    const declaration = getImportDeclarationForSymbol(importedSymbol);
    const importedName = getImportedName(importedSymbol.declarationNode);
    if (
      !declaration ||
      declaration.importKind === "type" ||
      importSpecifier.importKind === "type" ||
      typeof declaration.source.value !== "string" ||
      (!declaration.source.value.startsWith("./") && !declaration.source.value.startsWith("../")) ||
      !importedName
    ) {
      return false;
    }
    const source = declaration.source.value;
    let provider = providerBySource.get(source);
    if (provider === undefined) {
      const providerPath = resolveRelativeImportPath(context.filename, source);
      provider = providerPath ? parseSourceFile(providerPath) : null;
      providerBySource.set(source, provider);
    }
    const resolvedKind = provider ? getFrozenLiteralExportKind(provider, importedName) : null;
    for (const symbol of checkedSymbols) kindBySymbolId.set(symbol.id, resolvedKind);
    return resolvedKind === collectionKind;
  };
};
