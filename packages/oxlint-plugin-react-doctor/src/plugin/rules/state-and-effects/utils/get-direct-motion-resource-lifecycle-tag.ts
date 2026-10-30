import type { Reference, Variable } from "eslint-scope";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getRef } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";

interface DirectMotionResourceLifecycleInput {
  analysis: ProgramAnalysis;
  attribute: EsTreeNode;
  context: RuleContext;
  effectNode: EsTreeNode;
  matchesFailureLatchWriter: (reference: Reference) => boolean;
  setterReference: Reference;
}

const closedProvidersByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, ReadonlySet<number>>
>();
const readonlyVariables = new WeakMap<Variable, boolean>();
const dependencyVariablesByEffect = new WeakMap<EsTreeNode, ReadonlySet<Variable>>();

const isMotionModule = (source: unknown): boolean =>
  typeof source === "string" &&
  (source === "framer-motion" ||
    source.startsWith("framer-motion/") ||
    source === "motion" ||
    source.startsWith("motion/"));

const isReadonlyHostReference = (reference: EsTreeNode): boolean => {
  const member = reference.parent;
  if (
    !isNodeOfType(member, "JSXMemberExpression") ||
    member.object !== reference ||
    !isNodeOfType(member.property, "JSXIdentifier") ||
    !HTML_TAGS.has(member.property.name)
  ) {
    return false;
  }
  const element = member.parent;
  return Boolean(
    (isNodeOfType(element, "JSXOpeningElement") || isNodeOfType(element, "JSXClosingElement")) &&
    element.name === member,
  );
};

const getClosedProviders = (scopes: ScopeAnalysis, program: EsTreeNode): ReadonlySet<number> => {
  let providersByProgram = closedProvidersByScopes.get(scopes);
  if (!providersByProgram) {
    providersByProgram = new WeakMap();
    closedProvidersByScopes.set(scopes, providersByProgram);
  }
  const cached = providersByProgram.get(program);
  if (cached) return cached;
  let hasUnsupportedProvider = false;
  walkAst(program, (node) => {
    if (hasUnsupportedProvider) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      (isNodeOfType(node, "Identifier") &&
        (node.name === "require" || node.name === "createRequire"))
    ) {
      hasUnsupportedProvider = true;
      return false;
    }
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration")) &&
      isMotionModule(node.source?.value)
    ) {
      hasUnsupportedProvider = true;
      return false;
    }
    if (!isNodeOfType(node, "ImportDeclaration")) return;
    if (isTypeOnlyImport(node)) return false;
    if (node.source.value === "module" || node.source.value === "node:module") {
      hasUnsupportedProvider = true;
      return false;
    }
    if (!isMotionModule(node.source.value)) return;
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      if (
        !isNodeOfType(specifier, "ImportSpecifier") ||
        getImportedName(specifier) === "m" ||
        (getImportedName(specifier) === "motion" &&
          node.source.value !== "framer-motion" &&
          node.source.value !== "motion/react")
      ) {
        hasUnsupportedProvider = true;
        return false;
      }
    }
  });
  const providers = new Set<number>();
  if (!hasUnsupportedProvider) {
    for (const symbol of scopes.rootScope.symbols) {
      const declaration = getImportDeclarationForSymbol(symbol);
      if (
        !declaration ||
        isTypeOnlyImport(declaration) ||
        !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
        symbol.declarationNode.importKind === "type" ||
        getImportedName(symbol.declarationNode) !== "motion" ||
        (declaration.source.value !== "framer-motion" &&
          declaration.source.value !== "motion/react")
      ) {
        continue;
      }
      if (symbol.references.some((reference) => !isReadonlyHostReference(reference.identifier))) {
        hasUnsupportedProvider = true;
        break;
      }
      providers.add(symbol.id);
    }
  }
  if (hasUnsupportedProvider) providers.clear();
  providersByProgram.set(program, providers);
  return providers;
};

const isReadonlyVariable = (variable: Variable): boolean => {
  const cached = readonlyVariables.get(variable);
  if (cached !== undefined) return cached;
  const isReadonly =
    variable.defs.length === 1 &&
    variable.references.every((reference) => reference.init || !reference.isWrite());
  readonlyVariables.set(variable, isReadonly);
  return isReadonly;
};

const isBindingInitializedBeforeEffect = (
  identifier: EsTreeNode,
  effectNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const componentFunction = findEnclosingFunction(effectNode);
  const effectStatement = effectNode.parent;
  if (
    !componentFunction ||
    !isFunctionLike(componentFunction) ||
    !isNodeOfType(effectStatement, "ExpressionStatement") ||
    effectStatement.parent !== componentFunction.body
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || symbol.scope.node !== componentFunction) return false;
  if (symbol.kind === "parameter") return true;
  const declarator = symbol.declarationNode;
  const declaration = declarator.parent;
  return (
    symbol.kind === "const" &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    Boolean(declarator.init) &&
    isNodeOfType(declaration, "VariableDeclaration") &&
    declaration.kind === "const" &&
    declaration.parent === componentFunction.body &&
    declaration.range[1] <= effectStatement.range[0]
  );
};

const getDirectDependencyVariables = (
  effectNode: EsTreeNode,
  analysis: ProgramAnalysis,
): ReadonlySet<Variable> => {
  const cached = dependencyVariablesByEffect.get(effectNode);
  if (cached) return cached;
  const variables = new Set<Variable>();
  const dependencies = isNodeOfType(effectNode, "CallExpression") ? effectNode.arguments[1] : null;
  if (isNodeOfType(dependencies, "ArrayExpression")) {
    for (const dependency of dependencies.elements) {
      if (!dependency) continue;
      const identifier = stripParenExpression(dependency);
      if (!isNodeOfType(identifier, "Identifier")) continue;
      const variable = getRef(analysis, identifier)?.resolved;
      if (variable) variables.add(variable);
    }
  }
  dependencyVariablesByEffect.set(effectNode, variables);
  return variables;
};

export const getDirectMotionResourceLifecycleTag = ({
  analysis,
  attribute,
  context,
  effectNode,
  matchesFailureLatchWriter,
  setterReference,
}: DirectMotionResourceLifecycleInput): string | null => {
  const openingElement = attribute.parent;
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isNodeOfType(openingElement.name, "JSXMemberExpression") ||
    !isNodeOfType(openingElement.name.object, "JSXIdentifier") ||
    !isNodeOfType(openingElement.name.property, "JSXIdentifier")
  ) {
    return null;
  }
  const tag = openingElement.name.property.name;
  if (tag !== "video" && tag !== "audio" && tag !== "img") return null;
  const program = findProgramRoot(openingElement);
  if (!program || program !== context.scopes.rootScope.node) return null;
  const provider = context.scopes.symbolFor(openingElement.name.object);
  if (!provider || !getClosedProviders(context.scopes, program).has(provider.id)) return null;
  const names = new Set<string>();
  let source: EsTreeNode | null = null;
  for (const sibling of openingElement.attributes) {
    if (!isNodeOfType(sibling, "JSXAttribute")) return null;
    const name = getJsxAttributeName(sibling.name);
    if (!name || names.has(name)) return null;
    names.add(name);
    if (name === "src" && isNodeOfType(sibling.value, "JSXExpressionContainer")) {
      source = stripParenExpression(sibling.value.expression);
    }
  }
  if (!isNodeOfType(source, "Identifier")) return null;
  const sourceVariable = getRef(analysis, source)?.resolved;
  if (
    !sourceVariable ||
    !isReadonlyVariable(sourceVariable) ||
    !isBindingInitializedBeforeEffect(source, effectNode, context.scopes) ||
    !getDirectDependencyVariables(effectNode, analysis).has(sourceVariable) ||
    !setterReference.resolved ||
    !isReadonlyVariable(setterReference.resolved) ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  ) {
    return null;
  }
  const handler = stripParenExpression(attribute.value.expression);
  if (
    (!isNodeOfType(handler, "ArrowFunctionExpression") &&
      !isNodeOfType(handler, "FunctionExpression")) ||
    handler.async ||
    handler.generator ||
    handler.params.length > 0
  ) {
    return null;
  }
  const statement = isNodeOfType(handler.body, "BlockStatement")
    ? handler.body.body.length === 1
      ? handler.body.body[0]
      : null
    : handler.body;
  const call =
    statement && isNodeOfType(statement, "ExpressionStatement")
      ? stripParenExpression(statement.expression)
      : statement && stripParenExpression(statement);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const setter = stripParenExpression(call.callee);
  const handlerReference = isNodeOfType(setter, "Identifier") ? getRef(analysis, setter) : null;
  return handlerReference?.resolved === setterReference.resolved &&
    isBindingInitializedBeforeEffect(setter, effectNode, context.scopes) &&
    matchesFailureLatchWriter(handlerReference)
    ? tag
    : null;
};
