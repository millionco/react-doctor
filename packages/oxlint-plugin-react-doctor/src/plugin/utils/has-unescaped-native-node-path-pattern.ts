import {
  NODE_FS_MODULE_NAMES,
  NODE_MODULE_LOADER_NAMES,
  NODE_PATH_ALIAS_BINDING_LIMIT,
  NODE_PATH_EXPOSED_GLOBAL_NAMES,
  NODE_PATH_FORBIDDEN_SELECTORS,
  NODE_PATH_MODULE_NAMES,
  NODE_PATH_REPLACE_ARGUMENT_COUNT,
  NODE_PATH_SINGLE_ARGUMENT_COUNT,
} from "./native-node-path-pattern/constants.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { findProgramRoot } from "./find-program-root.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface NativeNodePathProviders {
  readonly paths: Set<SymbolDescriptor>;
  readonly filesystems: Set<SymbolDescriptor>;
}

const closedProvidersByAnalysis = new WeakMap<ScopeAnalysis, NativeNodePathProviders | null>();
const readonlyConstBindingsByAnalysis = new WeakMap<
  ScopeAnalysis,
  WeakMap<SymbolDescriptor, boolean>
>();

const isReadonlyConstBefore = (
  symbol: SymbolDescriptor,
  reference: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let readonlyConstBindings = readonlyConstBindingsByAnalysis.get(scopes);
  if (!readonlyConstBindings) {
    readonlyConstBindings = new WeakMap<SymbolDescriptor, boolean>();
    readonlyConstBindingsByAnalysis.set(scopes, readonlyConstBindings);
  }
  let isReadonlyConst = readonlyConstBindings.get(symbol);
  const declaration = symbol.declarationNode;
  if (isReadonlyConst === undefined) {
    isReadonlyConst =
      symbol.kind === "const" &&
      !isNodeOfType(declaration.parent?.parent, "ExportNamedDeclaration") &&
      isNodeOfType(declaration, "VariableDeclarator") &&
      declaration.id === symbol.bindingIdentifier &&
      isNodeOfType(declaration.id, "Identifier") &&
      symbol.references.every(
        (reference) => reference.flag === "read" && !isMemberMutationTarget(reference.identifier),
      );
    readonlyConstBindings.set(symbol, isReadonlyConst);
  }
  return (
    isReadonlyConst &&
    getNodeEndIndex(declaration) >= 0 &&
    getNodeEndIndex(declaration) < getNodeStartIndex(reference)
  );
};

const readRequireModule = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const inner = stripParenExpression(node);
  if (
    !isNodeOfType(inner, "CallExpression") ||
    inner.optional ||
    !isNodeOfType(inner.callee, "Identifier") ||
    inner.callee.name !== "require" ||
    !scopes.isGlobalReference(inner.callee) ||
    inner.arguments.length !== NODE_PATH_SINGLE_ARGUMENT_COUNT
  )
    return null;
  const argument = inner.arguments[0];
  return argument ? getStaticStringExpression(argument) : null;
};

const hasDirectProviderReferences = (
  symbol: SymbolDescriptor,
  methodName: string,
  scopes: ScopeAnalysis,
): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    const receiver = findTransparentExpressionRoot(identifier);
    const member = receiver.parent;
    const call = member?.parent;
    return (
      reference.flag === "read" &&
      (symbol.kind === "import" || isReadonlyConstBefore(symbol, identifier, scopes)) &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === receiver &&
      !member.optional &&
      getResolvedStaticPropertyName(member, scopes) === methodName &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === member &&
      !call.optional
    );
  });

const collectClosedProviders = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): NativeNodePathProviders | null => {
  const cachedProviders = closedProvidersByAnalysis.get(scopes);
  if (cachedProviders !== undefined) return cachedProviders;
  const paths = new Set<SymbolDescriptor>();
  const filesystems = new Set<SymbolDescriptor>();
  const providerCollections = new Map<string, Set<SymbolDescriptor>>();
  for (const source of NODE_PATH_MODULE_NAMES) providerCollections.set(source, paths);
  for (const source of NODE_FS_MODULE_NAMES) providerCollections.set(source, filesystems);
  let isClosed = true;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (
      ("declare" in node && node.declare === true) ||
      node.type === "WithStatement" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "ImportExpression"
    ) {
      isClosed = false;
      return false;
    }
    if (
      node.type === "TSInterfaceDeclaration" ||
      node.type === "TSTypeAliasDeclaration" ||
      isTypeScriptTypePosition(node)
    )
      return false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const selector = getResolvedStaticPropertyName(node, scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (selector === null || NODE_PATH_FORBIDDEN_SELECTORS.has(selector)) isClosed = false;
    }
    if (isNodeOfType(node, "Identifier")) {
      const reference = scopes.referenceFor(node);
      if (!reference) return;
      const symbol = reference.resolvedSymbol;
      if (NODE_PATH_EXPOSED_GLOBAL_NAMES.has(node.name) && scopes.isGlobalReference(node))
        isClosed = false;
      if (symbol?.kind === "import") {
        const declaration = symbol.declarationNode.parent;
        if (isNodeOfType(declaration, "ImportDeclaration") && isTypeOnlyImport(declaration))
          isClosed = false;
      }
      if (node.name === "RegExp" && scopes.isGlobalReference(node)) {
        const parent = node.parent;
        if (
          reference.flag !== "read" ||
          (!isNodeOfType(parent, "CallExpression") && !isNodeOfType(parent, "NewExpression")) ||
          parent.callee !== node ||
          ("optional" in parent && parent.optional)
        )
          isClosed = false;
      }
      if (node.name === "process" && scopes.isGlobalReference(node)) isClosed = false;
      if (node.name === "module" && scopes.isGlobalReference(node)) {
        const member = node.parent;
        const assignment = member?.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== node ||
          member.optional ||
          member.computed ||
          !isNodeOfType(member.property, "Identifier") ||
          member.property.name !== "exports" ||
          !isNodeOfType(assignment, "AssignmentExpression") ||
          assignment.left !== member ||
          assignment.operator !== "="
        )
          isClosed = false;
      }
      if (node.name === "require" && scopes.isGlobalReference(node)) {
        const parent = node.parent;
        const directCall =
          isNodeOfType(parent, "CallExpression") &&
          parent.callee === node &&
          !parent.optional &&
          parent.arguments.length === NODE_PATH_SINGLE_ARGUMENT_COUNT &&
          Boolean(parent.arguments[0] && getStaticStringExpression(parent.arguments[0]) !== null);
        const resolveCall =
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === node &&
          !parent.optional &&
          getResolvedStaticPropertyName(parent, scopes) === "resolve" &&
          isNodeOfType(parent.parent, "CallExpression") &&
          parent.parent.callee === parent &&
          !parent.parent.optional &&
          parent.parent.arguments.length === NODE_PATH_SINGLE_ARGUMENT_COUNT &&
          Boolean(
            parent.parent.arguments[0] &&
            getStaticStringExpression(parent.parent.arguments[0]) !== null,
          );
        if (!directCall && !resolveCall) isClosed = false;
      }
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (isTypeOnlyImport(node)) return false;
      const source = getStaticStringExpression(node.source);
      if (source && NODE_MODULE_LOADER_NAMES.has(source)) {
        isClosed = false;
        return;
      }
      const collection = source ? providerCollections.get(source) : null;
      if (!collection) return;
      if (node.specifiers.length !== NODE_PATH_SINGLE_ARGUMENT_COUNT) {
        isClosed = false;
        return;
      }
      const specifier = node.specifiers[0];
      if (!specifier || !isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
        isClosed = false;
        return;
      }
      const symbol = scopes.symbolFor(specifier.local);
      if (!symbol) {
        isClosed = false;
        return;
      }
      collection.add(symbol);
    }
    const moduleName = readRequireModule(node, scopes);
    if (moduleName && NODE_MODULE_LOADER_NAMES.has(moduleName)) {
      isClosed = false;
      return;
    }
    const collection = moduleName ? providerCollections.get(moduleName) : null;
    if (!collection) return;
    const declaration = node.parent;
    if (
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== node ||
      !isNodeOfType(declaration.id, "Identifier")
    ) {
      isClosed = false;
      return;
    }
    const symbol = scopes.symbolFor(declaration.id);
    if (!symbol || symbol.kind !== "const") {
      isClosed = false;
      return;
    }
    collection.add(symbol);
  });
  if (
    !isClosed ||
    paths.size === 0 ||
    [...paths].some((symbol) => !hasDirectProviderReferences(symbol, "resolve", scopes)) ||
    [...filesystems].some((symbol) => !hasDirectProviderReferences(symbol, "realpathSync", scopes))
  ) {
    closedProvidersByAnalysis.set(scopes, null);
    return null;
  }
  const providers = { paths, filesystems };
  closedProvidersByAnalysis.set(scopes, providers);
  return providers;
};

const isDirectNamespaceCall = (
  expression: EsTreeNode,
  providers: Set<SymbolDescriptor>,
  methodName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    !isNodeOfType(expression.callee, "MemberExpression") ||
    expression.callee.optional ||
    getResolvedStaticPropertyName(expression.callee, scopes) !== methodName
  )
    return false;
  const receiver = stripParenExpression(expression.callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  return Boolean(symbol && providers.has(symbol));
};

const isStaticPathSegment = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const inner = stripParenExpression(expression);
  if (getStaticStringExpression(inner) !== null) return true;
  if (isNodeOfType(inner, "Identifier"))
    return inner.name === "__dirname" && scopes.isGlobalReference(inner);
  if (
    !isNodeOfType(inner, "CallExpression") ||
    inner.optional ||
    inner.arguments.length !== NODE_PATH_SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(inner.callee, "MemberExpression") ||
    inner.callee.optional ||
    getResolvedStaticPropertyName(inner.callee, scopes) !== "resolve" ||
    !isNodeOfType(inner.callee.object, "Identifier") ||
    inner.callee.object.name !== "require" ||
    !scopes.isGlobalReference(inner.callee.object)
  )
    return false;
  return Boolean(inner.arguments[0] && getStaticStringExpression(inner.arguments[0]) !== null);
};

const isNativePathProducer = (
  expression: EsTreeNode,
  providers: NativeNodePathProviders,
  scopes: ScopeAnalysis,
  remainingBindings = NODE_PATH_ALIAS_BINDING_LIMIT,
  visitedSymbols = new Set<SymbolDescriptor>(),
): boolean => {
  const inner = stripParenExpression(expression);
  if (isNodeOfType(inner, "Identifier")) {
    const symbol = scopes.symbolFor(inner);
    if (
      !symbol?.initializer ||
      remainingBindings === 0 ||
      visitedSymbols.has(symbol) ||
      !isReadonlyConstBefore(symbol, inner, scopes)
    )
      return false;
    visitedSymbols.add(symbol);
    return isNativePathProducer(
      symbol.initializer,
      providers,
      scopes,
      remainingBindings - 1,
      visitedSymbols,
    );
  }
  if (!isNodeOfType(inner, "CallExpression")) return false;
  if (isDirectNamespaceCall(inner, providers.paths, "resolve", scopes)) {
    return (
      inner.arguments.length > 0 &&
      inner.arguments.every((argument) => isStaticPathSegment(argument, scopes))
    );
  }
  if (isDirectNamespaceCall(inner, providers.filesystems, "realpathSync", scopes)) {
    const argument = inner.arguments[0];
    return (
      inner.arguments.length === NODE_PATH_SINGLE_ARGUMENT_COUNT &&
      Boolean(
        argument &&
        isDirectNamespaceCall(stripParenExpression(argument), providers.paths, "resolve", scopes) &&
        isNativePathProducer(argument, providers, scopes, remainingBindings, visitedSymbols),
      )
    );
  }
  if (
    inner.optional ||
    inner.arguments.length !== NODE_PATH_REPLACE_ARGUMENT_COUNT ||
    !isNodeOfType(inner.callee, "MemberExpression") ||
    inner.callee.optional ||
    getResolvedStaticPropertyName(inner.callee, scopes) !== "replace"
  )
    return false;
  const [pattern, replacement] = inner.arguments;
  return Boolean(
    pattern &&
    isNodeOfType(pattern, "Literal") &&
    "regex" in pattern &&
    pattern.regex &&
    pattern.regex.pattern === "[/\\\\]" &&
    pattern.regex.flags === "g" &&
    replacement &&
    isNodeOfType(replacement, "Literal") &&
    replacement.value === "/" &&
    isNativePathProducer(inner.callee.object, providers, scopes, remainingBindings, visitedSymbols),
  );
};

const readNativePatternParts = (
  expression: EsTreeNode,
  flattenPatternParts: (node: EsTreeNode) => Array<string | EsTreeNode> | null,
): Array<string | EsTreeNode> | null => {
  const inner = stripParenExpression(expression);
  if (isNodeOfType(inner, "CallExpression")) return [inner];
  if (isNodeOfType(inner, "BinaryExpression") && inner.operator === "+") {
    const left = readNativePatternParts(inner.left, flattenPatternParts);
    const right = readNativePatternParts(inner.right, flattenPatternParts);
    return left && right ? [...left, ...right] : null;
  }
  if (
    isNodeOfType(inner, "TemplateLiteral") ||
    isNodeOfType(inner, "Identifier") ||
    getStaticStringExpression(inner) !== null
  ) {
    return flattenPatternParts(inner);
  }
  return null;
};

export const hasUnescapedNativeNodePathPattern = (
  construction: EsTreeNode,
  argument: EsTreeNode,
  scopes: ScopeAnalysis,
  flattenPatternParts: (node: EsTreeNode) => Array<string | EsTreeNode> | null,
  isShapeGuarded: (identifier: EsTreeNodeOfType<"Identifier">) => boolean,
): boolean => {
  if (
    ("optional" in construction && construction.optional) ||
    !isNodeOfType(scopes.rootScope.node, "Program")
  )
    return false;
  const parts = readNativePatternParts(argument, flattenPatternParts);
  if (!parts) return false;
  const dynamicIndex = parts.findIndex((part) => typeof part !== "string");
  const dynamicPart = parts[dynamicIndex];
  if (
    !dynamicPart ||
    typeof dynamicPart === "string" ||
    parts.slice(dynamicIndex + 1).some((part) => typeof part !== "string")
  )
    return false;
  const prefix = parts.slice(0, dynamicIndex).join("");
  const suffix = parts.slice(dynamicIndex + 1).join("");
  if ((prefix !== "" && prefix !== "^") || (!suffix.startsWith("/") && !suffix.startsWith(".*")))
    return false;
  if (isNodeOfType(dynamicPart, "Identifier") && isShapeGuarded(dynamicPart)) return false;
  const program = findProgramRoot(construction);
  if (!program) return false;
  const providers = collectClosedProviders(program, scopes);
  return Boolean(providers && isNativePathProducer(dynamicPart, providers, scopes));
};
