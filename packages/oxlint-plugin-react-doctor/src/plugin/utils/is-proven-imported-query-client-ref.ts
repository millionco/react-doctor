import * as path from "node:path";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import { attachParentReferences } from "./attach-parent-references.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  isOrdinaryFileWithinQueryClientProject,
  proveLockedQueryClientProject,
} from "./prove-locked-query-client-project.js";
import { readImmutableQueryClientExport } from "./read-immutable-query-client-export.js";
import { resolveUniqueDirectModuleFile } from "./resolve-relative-import-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const resolveSiblingTypeScriptFile = (filename: string, request: string): string | null => {
  if (!/^\.\/[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(request)) return null;
  const resolved = resolveUniqueDirectModuleFile(path.resolve(path.dirname(filename), request));
  return resolved && path.extname(resolved) === ".ts" ? resolved : null;
};

const lexicalValueSymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier") && !isNodeOfType(identifier, "JSXIdentifier"))
    return null;
  const symbol = scopes.symbolFor(identifier);
  if (symbol) return symbol;
  let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(identifier);
  while (scope) {
    const candidate = scope.symbolsByName.get(identifier.name);
    if (candidate) return candidate;
    scope = scope.parent;
  }
  return null;
};

const isErasedReactName = (node: EsTreeNode): boolean => {
  let qualified = node.parent;
  while (isNodeOfType(qualified, "TSQualifiedName")) qualified = qualified.parent;
  return isNodeOfType(qualified, "TSTypeReference") || isNodeOfType(qualified, "TSTypeQuery");
};

const hasUnmodifiedReactRefFactory = (
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const initializer = refSymbol.initializer && stripParenExpression(refSymbol.initializer);
  if (!isNodeOfType(initializer, "CallExpression") || initializer.optional) return false;
  const callee = stripParenExpression(initializer.callee);
  const usesNamespace = isNodeOfType(callee, "MemberExpression");
  if (
    usesNamespace &&
    (callee.computed ||
      callee.optional ||
      !isNodeOfType(callee.property, "Identifier") ||
      callee.property.name !== "useRef")
  )
    return false;
  const receiver = usesNamespace ? stripParenExpression(callee.object) : callee;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  const specifier = symbol?.declarationNode;
  const declaration = specifier?.parent;
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.importKind === "type" ||
    declaration.attributes?.length ||
    declaration.source.value !== "react"
  )
    return false;
  if (usesNamespace) {
    if (
      !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
      !isNodeOfType(specifier, "ImportNamespaceSpecifier")
    )
      return false;
  } else if (
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    !isNodeOfType(specifier.imported, "Identifier") ||
    specifier.imported.name !== "useRef"
  )
    return false;
  const program = scopes.rootScope.node;
  if (!isNodeOfType(program, "Program") || declaration.specifiers.length !== 1) return false;
  let isClosed = true;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "Identifier") &&
        ["require", "eval", "Function"].includes(node.name) &&
        scopes.isGlobalReference(node)) ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node !== declaration &&
        node.source.value === "react" &&
        node.importKind !== "type")
    ) {
      isClosed = false;
      return false;
    }
    if (
      node === symbol.bindingIdentifier ||
      (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
      node.name !== symbol.name ||
      lexicalValueSymbol(node, scopes) !== symbol ||
      isErasedReactName(node)
    )
      return;
    const parent = node.parent;
    if (
      usesNamespace &&
      isNodeOfType(parent, "JSXMemberExpression") &&
      parent.object === node &&
      parent.property.name === "Suspense"
    )
      return;
    if (
      usesNamespace &&
      (!isNodeOfType(parent, "MemberExpression") ||
        parent.object !== node ||
        parent.computed ||
        parent.optional ||
        !isNodeOfType(parent.property, "Identifier") ||
        parent.property.name !== "useRef")
    ) {
      isClosed = false;
      return false;
    }
    const callTarget = usesNamespace ? parent : node;
    const call = callTarget?.parent;
    if (!isNodeOfType(call, "CallExpression") || call.optional || call.callee !== callTarget)
      isClosed = false;
  });
  return isClosed;
};

const getQueryClientImportName = (symbol: SymbolDescriptor): string | null => {
  const specifier = symbol.declarationNode;
  return symbol.kind === "import" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(specifier.imported, "Identifier")
    ? specifier.imported.name
    : null;
};

const hasMatchingImportedType = (
  refSymbol: SymbolDescriptor,
  importSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const initializer = refSymbol.initializer && stripParenExpression(refSymbol.initializer);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.typeArguments?.params.length !== 1
  )
    return false;
  const type = initializer.typeArguments.params[0];
  return (
    isNodeOfType(type, "TSTypeQuery") &&
    isNodeOfType(type.exprName, "Identifier") &&
    lexicalValueSymbol(type.exprName, scopes) === importSymbol
  );
};

const isClosedOptionValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  earlierValues: ReadonlyMap<SymbolDescriptor, boolean>,
  requiresNumber = false,
): boolean => {
  if (isNodeOfType(expression, "Literal")) {
    return (
      typeof expression.value === "number" ||
      (!requiresNumber &&
        (typeof expression.value === "string" ||
          typeof expression.value === "boolean" ||
          expression.value === null))
    );
  }
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    const numeric = symbol && earlierValues.get(symbol);
    return numeric === true || (numeric === false && !requiresNumber);
  }
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    ["+", "-", "*", "/"].includes(expression.operator)
  ) {
    return (
      isClosedOptionValue(expression.left, scopes, earlierValues, true) &&
      isClosedOptionValue(expression.right, scopes, earlierValues, true)
    );
  }
  if (requiresNumber || !isNodeOfType(expression, "ObjectExpression")) return false;
  const properties = new Set<string>();
  for (const property of expression.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    )
      return false;
    const key = getStaticPropertyKeyName(property);
    if (
      !key ||
      key === "__proto__" ||
      properties.has(key) ||
      !isClosedOptionValue(property.value, scopes, earlierValues)
    )
      return false;
    properties.add(key);
  }
  return true;
};

const hasClosedQueryOptionsExport = (filename: string, exportedName: string): boolean => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program")) return false;
  attachParentReferences(program);
  const scopes = analyzeScopes(program);
  const earlierValues = new Map<SymbolDescriptor, boolean>();
  let sawTypeImport = false;
  let foundExport = false;
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      if (
        sawTypeImport ||
        earlierValues.size > 0 ||
        statement.source.value !== "@tanstack/react-query" ||
        statement.specifiers.length !== 1 ||
        statement.attributes?.length
      )
        return false;
      const [specifier] = statement.specifiers;
      if (
        !isNodeOfType(specifier, "ImportSpecifier") ||
        !isNodeOfType(specifier.imported, "Identifier") ||
        specifier.imported.name !== "DefaultOptions" ||
        scopes.symbolFor(specifier.local)?.references.length !== 0
      )
        return false;
      sawTypeImport = true;
      continue;
    }
    if (
      !isNodeOfType(statement, "ExportNamedDeclaration") ||
      statement.source ||
      statement.specifiers.length !== 0 ||
      !isNodeOfType(statement.declaration, "VariableDeclaration") ||
      statement.declaration.kind !== "const" ||
      statement.declaration.declarations.length !== 1
    )
      return false;
    const [declaration] = statement.declaration.declarations;
    if (
      !isNodeOfType(declaration.id, "Identifier") ||
      !declaration.init ||
      !isClosedOptionValue(declaration.init, scopes, earlierValues)
    )
      return false;
    const symbol = scopes.symbolFor(declaration.id);
    if (!symbol || symbol.kind !== "const" || earlierValues.has(symbol)) return false;
    earlierValues.set(symbol, isClosedOptionValue(declaration.init, scopes, earlierValues, true));
    if (declaration.id.name === exportedName) {
      if (foundExport || !isNodeOfType(declaration.init, "ObjectExpression")) return false;
      foundExport = true;
    }
  }
  return foundExport;
};

export const isProvenImportedQueryClientRef = (
  value: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  if (!filename || !path.isAbsolute(filename)) return false;
  const expression = stripParenExpression(value);
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  if (
    !symbol ||
    !hasMatchingImportedType(refSymbol, symbol, scopes) ||
    !hasUnmodifiedReactRefFactory(refSymbol, scopes)
  )
    return false;
  const exportedName = getQueryClientImportName(symbol);
  const declaration = symbol.declarationNode.parent;
  if (
    !exportedName ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.importKind === "type" ||
    declaration.attributes?.length ||
    typeof declaration.source.value !== "string"
  )
    return false;
  const provider = resolveSiblingTypeScriptFile(filename, declaration.source.value);
  if (!provider) return false;
  const root = proveLockedQueryClientProject(filename, provider);
  if (!root) return false;
  const providerProgram = parseSourceFile(provider);
  if (!providerProgram) return false;
  attachParentReferences(providerProgram);
  const immutable = readImmutableQueryClientExport(
    providerProgram,
    analyzeScopes(providerProgram),
    exportedName,
  );
  if (!immutable) return false;
  if (!immutable.optionsImport) return true;
  const optionsPath = resolveSiblingTypeScriptFile(provider, immutable.optionsImport.source);
  return (
    optionsPath !== null &&
    optionsPath !== provider &&
    isOrdinaryFileWithinQueryClientProject(optionsPath, root) &&
    hasClosedQueryOptionsExport(optionsPath, immutable.optionsImport.importedName)
  );
};
