import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { findVisibleSymbol } from "./find-visible-symbol.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasEnclosingTypeParameterNamed } from "./has-enclosing-type-parameter-named.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

type Field = EsTreeNodeOfType<"PropertyDefinition">;

const namesByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, string | null>>();
const dynamicScopeByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const isPublicStaticField = (node: EsTreeNode | null | undefined): node is Field =>
  isNodeOfType(node, "PropertyDefinition") &&
  node.static &&
  !node.computed &&
  node.accessibility !== "private" &&
  node.accessibility !== "protected" &&
  !node.decorators?.length &&
  isNodeOfType(node.key, "Identifier") &&
  /^[A-Z]/.test(node.key.name);

const hasReactComponentAnnotation = (field: Field, scopes: ScopeAnalysis): boolean => {
  const annotation = field.typeAnnotation?.typeAnnotation;
  if (!isNodeOfType(annotation, "TSTypeReference")) return false;
  const qualified = annotation.typeName;
  if (
    !isNodeOfType(qualified, "TSQualifiedName") ||
    !isNodeOfType(qualified.left, "Identifier") ||
    (qualified.right.name !== "FC" && qualified.right.name !== "FunctionComponent") ||
    hasEnclosingTypeParameterNamed(qualified.left, qualified.left.name)
  ) {
    return false;
  }
  const symbol = findVisibleSymbol(qualified.left, scopes);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    (!isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
      !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"))
  ) {
    return false;
  }
  return getImportDeclarationForSymbol(symbol)?.source.value === "react";
};

const returnsOwnJsx = (
  fn: EsTreeNodeOfType<"ArrowFunctionExpression">,
  context: RuleContext,
): boolean => {
  let returned: EsTreeNode = fn.body;
  if (isNodeOfType(returned, "BlockStatement")) {
    const statement = returned.body.at(-1);
    if (
      !isNodeOfType(statement, "ReturnStatement") ||
      !statement.argument ||
      !isNodeReachableWithinFunction(statement, context)
    ) {
      return false;
    }
    returned = statement.argument;
  }
  const expression = stripParenExpression(returned);
  return isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment");
};

const hasDynamicScope = (scopes: ScopeAnalysis): boolean => {
  const cached = dynamicScopeByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let dynamic = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (dynamic || isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.isGlobalReference(node))
    ) {
      dynamic = true;
    }
  });
  dynamicScopeByAnalysis.set(scopes, dynamic);
  return dynamic;
};

const getComponentName = (fn: EsTreeNode, context: RuleContext): string | null => {
  if (!isNodeOfType(fn, "ArrowFunctionExpression")) return null;
  const { scopes } = context;
  const field = fn.parent;
  if (!isPublicStaticField(field) || field.value !== fn || !isNodeOfType(field.key, "Identifier"))
    return null;
  const body = field.parent;
  const facade = body?.parent;
  if (
    !isNodeOfType(body, "ClassBody") ||
    !isNodeOfType(facade, "ClassDeclaration") ||
    !facade.id ||
    facade.superClass ||
    facade.decorators?.length ||
    (!isNodeOfType(facade.parent, "ExportDefaultDeclaration") &&
      !isNodeOfType(facade.parent, "ExportNamedDeclaration")) ||
    facade.parent.parent !== scopes.rootScope.node ||
    !hasReactComponentAnnotation(field, scopes) ||
    !returnsOwnJsx(fn, context)
  ) {
    return null;
  }
  const classSymbol = scopes.symbolFor(facade.id);
  if (
    !classSymbol ||
    classSymbol.declarationNode !== facade ||
    !isSymbolReadOnly(classSymbol) ||
    !hasCompleteSymbolReferences(classSymbol, scopes.rootScope.node, scopes) ||
    hasDynamicScope(scopes)
  ) {
    return null;
  }

  const fieldName = field.key.name;
  const aliases = new Map<string, Field>();
  const staticNames = new Map<string, number>();
  let sawField = false;
  for (const member of body.body) {
    if (
      isNodeOfType(member, "StaticBlock") ||
      ("decorators" in member && member.decorators?.length)
    )
      return null;
    const name = getStaticPropertyKeyName(member, { allowComputedString: true });
    if (name === "render" || name === "isReactComponent") return null;
    if ("computed" in member && member.computed && name === null) return null;
    if ("static" in member && member.static) {
      if (name === null) return null;
      staticNames.set(name, (staticNames.get(name) ?? 0) + 1);
    }
    if (member === field) {
      sawField = true;
      continue;
    }
    if (!sawField || !name || !isPublicStaticField(member) || !member.value) continue;
    const value = stripParenExpression(member.value);
    if (
      isNodeOfType(value, "MemberExpression") &&
      !value.optional &&
      !value.computed &&
      isNodeOfType(value.property, "Identifier") &&
      value.property.name === fieldName &&
      scopes.symbolFor(value.object) === classSymbol
    ) {
      aliases.set(name, member);
    }
  }
  const componentNames = new Set([fieldName, ...aliases.keys()]);
  if ([...componentNames].some((name) => staticNames.get(name) !== 1)) return null;

  // A plain facade can expose methods and constants. The render field and its
  // direct aliases must stay on the JSX route or in a same-class alias initializer.
  let hasJsxUse = false;
  for (const { identifier } of classSymbol.references) {
    if (isKeyedDraftTypeReference(identifier)) continue;
    const receiver = findTransparentExpressionRoot(identifier);
    const access = receiver.parent;
    if (isNodeOfType(access, "JSXMemberExpression") && access.object === receiver) {
      if (componentNames.has(access.property.name)) {
        if (isNodeOfType(access.parent, "JSXOpeningElement")) hasJsxUse = true;
        else if (!isNodeOfType(access.parent, "JSXClosingElement")) return null;
      }
      continue;
    }
    if (!isNodeOfType(access, "MemberExpression") || access.object !== receiver) return null;
    const name = getResolvedStaticPropertyName(access, scopes, { allowConstTemplateLiteral: true });
    if (name === null || name === "prototype" || name === "isReactComponent") return null;
    if (!componentNames.has(name)) continue;
    const root = findTransparentExpressionRoot(access);
    const alias = root.parent;
    if (
      !isPublicStaticField(alias) ||
      alias.value !== root ||
      !isNodeOfType(alias.key, "Identifier") ||
      aliases.get(alias.key.name) !== alias
    )
      return null;
  }
  if (
    !hasJsxUse &&
    ![...aliases.values()].some((alias) => hasReactComponentAnnotation(alias, scopes))
  )
    return null;

  let hasThisUse = false;
  walkAst(body, (node) => {
    if (hasThisUse || isKeyedDraftTypeReference(node)) return false;
    if (isNodeOfType(node, "ThisExpression")) hasThisUse = true;
  });
  return hasThisUse ? null : fieldName;
};

export const getStaticFacadeComponentName = (
  fn: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(fn, "ArrowFunctionExpression") || !isPublicStaticField(fn.parent)) return null;
  let names = namesByScopes.get(context.scopes);
  if (!names) {
    names = new WeakMap();
    namesByScopes.set(context.scopes, names);
  }
  const cached = names.get(fn);
  if (cached !== undefined) return cached;
  const name = getComponentName(fn, context);
  names.set(fn, name);
  return name;
};
