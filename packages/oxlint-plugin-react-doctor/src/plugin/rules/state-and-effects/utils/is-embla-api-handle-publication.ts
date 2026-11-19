import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";

const EMBLA_MODULE = "embla-carousel-react";
const MOCK_METHODS = new Set(["mock", "doMock", "setMock", "unstable_mockModule"]);
const closedProvidersByScopes = new WeakMap<ScopeAnalysis, boolean>();

const isRuntimeImport = (symbol: SymbolDescriptor | null, source: string): boolean => {
  const declaration = symbol?.declarationNode.parent;
  return Boolean(
    symbol?.kind === "import" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === source &&
    !(
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type"
    ),
  );
};

const isDirectReactEffect = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (call.optional || !isReactApiCall(call, "useEffect", scopes)) return false;
  const callee = call.callee;
  if (isNodeOfType(callee, "Identifier")) return isRuntimeImport(scopes.symbolFor(callee), "react");
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    isNodeOfType(callee.object, "Identifier") &&
    isRuntimeImport(scopes.symbolFor(callee.object), "react")
  );
};

const isClosedReadonlySymbol = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  isSymbolReadOnly(symbol) &&
  symbol.references.every((reference) => !isWithinAssignmentTarget(reference.identifier)) &&
  hasCompleteSymbolReferences(symbol, program, scopes);

// Check that the stock React and Embla imports retain their provider semantics.
// Visible module replacements and namespace escapes invalidate the proof.
const hasClosedProviders = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = closedProvidersByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(program, (node) => {
    if (!closed || isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "Identifier") &&
        ["eval", "require", "Function"].includes(node.name) &&
        scopes.isGlobalReference(node))
    ) {
      closed = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      MOCK_METHODS.has(getStaticPropertyName(node) ?? "")
    ) {
      closed = false;
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      MOCK_METHODS.has(node.callee.name)
    ) {
      closed = false;
      return false;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      ["node:module", "module", "vitest", "@jest/globals", "node:test"].includes(
        String(node.source.value),
      )
    ) {
      closed = false;
      return false;
    }
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.importKind === "type" ||
      (node.source.value !== "react" && node.source.value !== EMBLA_MODULE)
    )
      return;
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const symbol = scopes.symbolFor(specifier.local);
      if (
        !symbol ||
        !isClosedReadonlySymbol(symbol, program, scopes) ||
        (node.source.value === EMBLA_MODULE && !isNodeOfType(specifier, "ImportDefaultSpecifier"))
      ) {
        closed = false;
        return false;
      }
      for (const reference of symbol.references) {
        if (isKeyedDraftTypeReference(reference.identifier)) continue;
        let callee = findTransparentExpressionRoot(reference.identifier);
        if (
          node.source.value === "react" &&
          isNodeOfType(callee.parent, "MemberExpression") &&
          callee.parent.object === callee &&
          !callee.parent.computed &&
          !callee.parent.optional
        )
          callee = findTransparentExpressionRoot(callee.parent);
        const call = callee.parent;
        if (!isNodeOfType(call, "CallExpression") || call.callee !== callee || call.optional) {
          closed = false;
          return false;
        }
      }
    }
  });
  closedProvidersByScopes.set(scopes, closed);
  return closed;
};

interface EmblaHandlePublicationInput {
  effect: EsTreeNodeOfType<"CallExpression">;
  publication: EsTreeNodeOfType<"CallExpression">;
  scopes: ScopeAnalysis;
  isPropName: (name: string, reference?: EsTreeNode) => boolean;
}

/** Recognize an isolated handoff of the external viewport engine.
 * The effect body and dependencies must refer to this handle and its callback prop.
 */
export const isEmblaApiHandlePublication = ({
  effect,
  publication,
  scopes,
  isPropName,
}: EmblaHandlePublicationInput): boolean => {
  if (
    effect.arguments.length !== 2 ||
    !isDirectReactEffect(effect, scopes) ||
    publication.optional ||
    publication.arguments.length !== 1 ||
    !isNodeOfType(publication.callee, "Identifier") ||
    !isNodeOfType(publication.arguments[0], "Identifier") ||
    !isPropName(publication.callee.name, publication.callee)
  )
    return false;
  const callback = effect.arguments[0];
  const dependencies = effect.arguments[1];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 2
  )
    return false;
  const api = scopes.symbolFor(publication.arguments[0]);
  const prop = scopes.symbolFor(publication.callee);
  const owner = findEnclosingFunction(effect);
  const program = findProgramRoot(effect);
  if (
    !api ||
    api.kind !== "const" ||
    !prop ||
    prop.kind !== "parameter" ||
    !owner ||
    !program ||
    findEnclosingFunction(prop.bindingIdentifier) !== owner ||
    findEnclosingFunction(api.declarationNode) !== owner ||
    findEnclosingFunction(publication) !== callback
  )
    return false;
  const propEntry = prop.bindingIdentifier.parent;
  if (
    !isNodeOfType(propEntry, "Property") ||
    propEntry.computed ||
    propEntry.method ||
    propEntry.kind !== "init" ||
    propEntry.value !== prop.bindingIdentifier ||
    !isNodeOfType(propEntry.parent, "ObjectPattern") ||
    (!isNodeOfType(owner, "ArrowFunctionExpression") &&
      !isNodeOfType(owner, "FunctionExpression") &&
      !isNodeOfType(owner, "FunctionDeclaration")) ||
    owner.params[0] !== propEntry.parent
  )
    return false;
  const declaration = api.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 2 ||
    !isNodeOfType(declaration.id.elements[0], "Identifier") ||
    declaration.id.elements[1] !== api.bindingIdentifier ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.optional ||
    declaration.init.arguments.length < 1 ||
    declaration.init.arguments.length > 2 ||
    declaration.init.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNodeOfType(declaration.init.callee, "Identifier")
  )
    return false;
  const hook = declaration.init;
  const provider = scopes.symbolFor(hook.callee);
  if (
    !isRuntimeImport(provider, EMBLA_MODULE) ||
    !provider ||
    !isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier") ||
    findEnclosingFunction(hook) !== owner
  )
    return false;
  const seenDependencies = new Set<SymbolDescriptor>();
  for (const dependency of dependencies.elements) {
    if (!isNodeOfType(dependency, "Identifier")) return false;
    const symbol = scopes.symbolFor(dependency);
    if (!symbol || (symbol !== api && symbol !== prop) || seenDependencies.has(symbol))
      return false;
    seenDependencies.add(symbol);
  }
  const guard = (test: EsTreeNode): boolean => {
    if (!isNodeOfType(test, "LogicalExpression") || test.operator !== "||") return false;
    const seen = new Set<SymbolDescriptor>();
    for (const part of [test.left, test.right]) {
      if (!isNodeOfType(part, "UnaryExpression") || part.operator !== "!") return false;
      const value = part.argument;
      if (!isNodeOfType(value, "Identifier")) return false;
      const symbol = scopes.symbolFor(value);
      if (!symbol || (symbol !== api && symbol !== prop) || seen.has(symbol)) return false;
      seen.add(symbol);
    }
    return seen.size === 2;
  };
  const isPublicationStatement = (node: EsTreeNode | null | undefined): boolean =>
    isNodeOfType(node, "ExpressionStatement") && node.expression === publication;
  const statements = callback.body.body;
  const first = statements[0];
  if (!isNodeOfType(first, "IfStatement") || first.alternate) return false;
  if (statements.length !== 2) return false;
  const exit =
    isNodeOfType(first.consequent, "BlockStatement") && first.consequent.body.length === 1
      ? first.consequent.body[0]
      : first.consequent;
  if (
    !isNodeOfType(exit, "ReturnStatement") ||
    exit.argument ||
    !guard(first.test) ||
    !isPublicationStatement(statements[1])
  )
    return false;
  return (
    [api, prop, provider].every((symbol) => isClosedReadonlySymbol(symbol, program, scopes)) &&
    hasClosedProviders(program, scopes)
  );
};
