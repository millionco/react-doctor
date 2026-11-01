import {
  COOKIE_GLOBAL_OBJECT_NAMES,
  COOKIE_EXPORT_CAPABILITY_NAMES,
  COOKIE_NATIVE_PROVIDER_NAMES,
  UNSUPPORTED_COOKIE_RUNTIME_NODES,
  COOKIE_ARITHMETIC_OPERATORS,
  DYNAMIC_PROVIDER_NAMES,
  DYNAMIC_PROVIDER_KEYS,
} from "./cookie-write/constants.js";
import { isNativeProviderReference } from "./cookie-write/is-native-provider-reference.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface CookieProgramFacts {
  readonly scopes: ScopeAnalysis;
  readonly providersClosed: boolean;
  readonly exportsClosed: boolean;
  readonly writesByFunction: WeakMap<EsTreeNode, boolean>;
}

const cookieProgramFacts = new WeakMap<EsTreeNode, CookieProgramFacts>();

const getCookieProgramFacts = (program: EsTreeNode): CookieProgramFacts => {
  const cached = cookieProgramFacts.get(program);
  if (cached) return cached;
  const scopes = analyzeScopes(program);
  let providersClosed = true;
  let exportsClosed = true;
  walkAst(program, (node) => {
    if (
      !providersClosed ||
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    )
      return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const propertyName = getStaticPropertyName(node);
      if (propertyName === null || DYNAMIC_PROVIDER_KEYS.has(propertyName)) {
        providersClosed = false;
        return false;
      }
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (propertyName === null || DYNAMIC_PROVIDER_KEYS.has(propertyName)) {
        providersClosed = false;
        return false;
      }
    }
    if (isNodeOfType(node, "RestElement") && isNodeOfType(node.parent, "ObjectPattern")) {
      providersClosed = false;
      return false;
    }
    if (UNSUPPORTED_COOKIE_RUNTIME_NODES.has(node.type)) {
      providersClosed = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || isTypeScriptTypePosition(node)) return;
    const parent = node.parent;
    if (scopes.symbolFor(node)?.bindingIdentifier === node) return;
    if (
      (isNodeOfType(parent, "MemberExpression") && parent.property === node && !parent.computed) ||
      (isNodeOfType(parent, "Property") &&
        parent.key === node &&
        !parent.computed &&
        (!parent.shorthand || isNodeOfType(parent.parent, "ObjectPattern"))) ||
      ((isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) &&
        parent.key === node &&
        !parent.computed) ||
      (isNodeOfType(parent, "ImportSpecifier") &&
        parent.imported === node &&
        parent.local !== node) ||
      (isNodeOfType(parent, "ExportSpecifier") &&
        parent.exported === node &&
        parent.local !== node) ||
      ((isNodeOfType(parent, "LabeledStatement") ||
        isNodeOfType(parent, "BreakStatement") ||
        isNodeOfType(parent, "ContinueStatement")) &&
        parent.label === node)
    )
      return;
    if (COOKIE_EXPORT_CAPABILITY_NAMES.has(node.name)) exportsClosed = false;
    if (DYNAMIC_PROVIDER_NAMES.has(node.name)) {
      providersClosed = false;
      return false;
    }
    if (!scopes.referenceFor(node)) {
      if (COOKIE_NATIVE_PROVIDER_NAMES.has(node.name) || COOKIE_GLOBAL_OBJECT_NAMES.has(node.name))
        providersClosed = false;
      return;
    }
    if (node.name === "Document" || node.name === "HTMLDocument") {
      providersClosed = false;
      return false;
    }
    if (COOKIE_GLOBAL_OBJECT_NAMES.has(node.name)) {
      const propertyName =
        isNodeOfType(parent, "MemberExpression") && parent.object === node
          ? getStaticPropertyName(parent)
          : null;
      providersClosed = propertyName !== null && !COOKIE_NATIVE_PROVIDER_NAMES.has(propertyName);
      return;
    }
    if (!isNativeProviderReference(node, scopes)) return;
    if (node.name === "encodeURIComponent") {
      providersClosed = Boolean(
        isNodeOfType(parent, "CallExpression") && parent.callee === node && !parent.optional,
      );
      return;
    }
    if (node.name !== "document") return;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof") return;
    if (!isNodeOfType(parent, "MemberExpression") || parent.object !== node || parent.optional) {
      providersClosed = false;
      return false;
    }
    const propertyName = getStaticPropertyName(parent);
    if (propertyName === "cookie") return;
    const call = parent.parent;
    const [elementType, ...otherArguments] = isNodeOfType(call, "CallExpression")
      ? call.arguments
      : [];
    providersClosed = Boolean(
      propertyName === "createElement" &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === parent &&
      !call.optional &&
      otherArguments.length === 0 &&
      isNodeOfType(elementType, "Literal") &&
      typeof elementType.value === "string",
    );
  });
  const facts = {
    scopes,
    providersClosed,
    exportsClosed,
    writesByFunction: new WeakMap<EsTreeNode, boolean>(),
  };
  cookieProgramFacts.set(program, facts);
  return facts;
};

const isCookieStringData = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  parameterSymbolIds: ReadonlySet<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) {
    return (
      candidate.value === null || ["string", "number", "boolean"].includes(typeof candidate.value)
    );
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    return Boolean(symbol && parameterSymbolIds.has(symbol.id));
  }
  if (isNodeOfType(candidate, "TemplateLiteral")) {
    return candidate.expressions.every((child) =>
      isCookieStringData(child, scopes, parameterSymbolIds),
    );
  }
  if (
    isNodeOfType(candidate, "BinaryExpression") &&
    COOKIE_ARITHMETIC_OPERATORS.has(candidate.operator)
  ) {
    return (
      isCookieStringData(candidate.left, scopes, parameterSymbolIds) &&
      isCookieStringData(candidate.right, scopes, parameterSymbolIds)
    );
  }
  if (
    isNodeOfType(candidate, "UnaryExpression") &&
    (candidate.operator === "+" || candidate.operator === "-")
  ) {
    return isCookieStringData(candidate.argument, scopes, parameterSymbolIds);
  }
  if (!isNodeOfType(candidate, "CallExpression") || candidate.optional) return false;
  const callee = stripParenExpression(candidate.callee);
  const [argument, ...otherArguments] = candidate.arguments;
  return Boolean(
    isNodeOfType(callee, "Identifier") &&
    callee.name === "encodeURIComponent" &&
    isNativeProviderReference(callee, scopes) &&
    argument &&
    !isNodeOfType(argument, "SpreadElement") &&
    otherArguments.length === 0 &&
    isCookieStringData(argument, scopes, parameterSymbolIds),
  );
};

const functionHasSingleCookieWrite = (
  functionNode: EsTreeNode,
  facts: CookieProgramFacts,
): boolean => {
  const cached = facts.writesByFunction.get(functionNode);
  if (cached !== undefined) return cached;
  const certify = (): boolean => {
    if (
      !isNodeOfType(functionNode, "ArrowFunctionExpression") ||
      functionNode.async ||
      functionNode.generator
    )
      return false;
    const declarator = functionNode.parent;
    const declaration = declarator?.parent;
    const exported = declaration?.parent;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== functionNode ||
      !isNodeOfType(declarator.id, "Identifier") ||
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.kind !== "const" ||
      !isNodeOfType(exported, "ExportNamedDeclaration") ||
      exported.exportKind === "type" ||
      !isNodeOfType(functionNode.body, "BlockStatement")
    )
      return false;
    const binding = facts.scopes.symbolFor(declarator.id);
    if (
      !binding ||
      binding.kind !== "const" ||
      binding.references.some((reference) => reference.flag !== "read")
    )
      return false;
    const parameterSymbolIds = new Set<number>();
    for (const parameter of functionNode.params) {
      if (!isNodeOfType(parameter, "Identifier")) return false;
      const parameterSymbol = facts.scopes.symbolFor(parameter);
      if (
        !parameterSymbol ||
        parameterSymbol.references.some((reference) => reference.flag !== "read")
      )
        return false;
      parameterSymbolIds.add(parameterSymbol.id);
    }
    const [statement, ...otherStatements] = functionNode.body.body;
    if (!isNodeOfType(statement, "ExpressionStatement") || otherStatements.length > 0) return false;
    const assignment = stripParenExpression(statement.expression);
    if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
      return false;
    const target = stripParenExpression(assignment.left);
    if (
      !isNodeOfType(target, "MemberExpression") ||
      target.optional ||
      getStaticPropertyName(target) !== "cookie"
    )
      return false;
    const receiver = stripParenExpression(target.object);
    return Boolean(
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "document" &&
      isNativeProviderReference(receiver, facts.scopes) &&
      isCookieStringData(assignment.right, facts.scopes, parameterSymbolIds),
    );
  };
  const result = certify();
  facts.writesByFunction.set(functionNode, result);
  return result;
};

export const callHasImportedCookieWrite = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!context.filename || call.optional || !isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return false;
  const imported = resolveImportedApiReference(callee, context.scopes);
  if (
    !imported ||
    imported.isNamespace ||
    !imported.importedName ||
    imported.importedName === "default"
  )
    return false;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    imported.source,
    imported.importedName,
  );
  if (!resolved || resolved.filePath !== resolveModulePath(context.filename, imported.source))
    return false;
  const callerProgram = findProgramRoot(call);
  if (!callerProgram) return false;
  const callerFacts = getCookieProgramFacts(callerProgram);
  const foreignFacts = getCookieProgramFacts(resolved.programNode);
  return (
    callerFacts.providersClosed &&
    foreignFacts.providersClosed &&
    foreignFacts.exportsClosed &&
    functionHasSingleCookieWrite(resolved.functionNode, foreignFacts)
  );
};
