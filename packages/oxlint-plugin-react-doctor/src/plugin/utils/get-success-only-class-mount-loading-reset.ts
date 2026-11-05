import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { findImmediatelyInvokedCallExpression } from "./find-immediately-invoked-call-expression.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalObjectReference } from "./is-proven-global-namespace-reference.js";
import { isProvenReactClassComponent } from "./is-proven-react-class-component.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isImportedFromReact, isReactNamespaceImport } from "./is-react-api-call.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { someAst } from "./some-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const MOUNT_LOADING_METHOD_NAMES = new Set(["constructor", "componentDidMount", "render"]);
const PROTOTYPE_ACCESS_NAMES = new Set([
  "prototype",
  "__proto__",
  "constructor",
  "getPrototypeOf",
  "setPrototypeOf",
  "defaultView",
  "ownerDocument",
]);
const DYNAMIC_PROVIDER_NAMES = new Set([
  "eval",
  "Function",
  "require",
  "module",
  "process",
  "React",
]);
const GLOBAL_PROVIDER_NAMES = new Set([
  ...DYNAMIC_PROVIDER_NAMES,
  "document",
  "frames",
  "opener",
  "parent",
  "top",
  "globalThis",
  "window",
  "self",
  "global",
]);
const CONSOLE_LOG_METHOD_NAMES = new Set(["log", "warn", "error"]);
const NETWORK_URL_PATTERN = /^(?:https?:\/\/|\/(?!\/))/i;

const getStatementExpression = (statement: EsTreeNode | undefined): EsTreeNode | null =>
  isNodeOfType(statement, "ExpressionStatement")
    ? stripParenExpression(statement.expression)
    : null;

const getSingleAwaitedCall = (statement: EsTreeNode | undefined, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.declarations.length !== 1) {
    return null;
  }
  const declaration = statement.declarations[0];
  if (!isNodeOfType(declaration?.id, "Identifier")) return null;
  const symbol = scopes.symbolFor(declaration.id);
  const initializer = symbol && getDirectConstInitializer(symbol);
  if (!initializer || initializer !== declaration.init) return null;
  const expression = stripParenExpression(initializer);
  if (!isNodeOfType(expression, "AwaitExpression")) return null;
  const call = stripParenExpression(expression.argument);
  return isNodeOfType(call, "CallExpression") && !call.optional ? { call, symbol } : null;
};

const getDataProperties = (node: EsTreeNode | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const values = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    ) {
      return null;
    }
    const key = getStaticPropertyKeyName(property);
    if (!key || key === "__proto__" || values.has(key)) return null;
    values.set(key, property.value);
  }
  return values;
};

const isDirectThisMember = (node: EsTreeNode | null | undefined, name: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  getStaticPropertyName(node) === name &&
  isNodeOfType(node.object, "ThisExpression");

const isDirectReactBase = (
  classNode: EsTreeNodeOfType<"ClassDeclaration">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!classNode.superClass || !isProvenReactClassComponent(classNode, scopes)) return false;
  const base = stripParenExpression(classNode.superClass);
  if (isNodeOfType(base, "MemberExpression")) {
    return (
      !base.computed &&
      !base.optional &&
      isNodeOfType(base.object, "Identifier") &&
      scopes.symbolFor(base.object)?.kind === "import" &&
      isReactNamespaceImport(base.object, scopes)
    );
  }
  if (!isNodeOfType(base, "Identifier")) return false;
  const symbol = scopes.symbolFor(base);
  return Boolean(symbol?.kind === "import" && isImportedFromReact(symbol));
};

const hasClosedClassProviderImports = (base: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const program = scopes.rootScope.node;
  if (!isNodeOfType(program, "Program")) return false;
  const baseReference = isNodeOfType(base, "MemberExpression") ? base.object : base;
  for (const statement of program.body) {
    if (
      (isNodeOfType(statement, "ExportNamedDeclaration") ||
        isNodeOfType(statement, "ExportAllDeclaration")) &&
      statement.source &&
      statement.exportKind !== "type"
    ) {
      return false;
    }
    if (!isNodeOfType(statement, "ImportDeclaration") || statement.importKind === "type") continue;
    if (statement.specifiers.length === 0) return false;
    for (const specifier of statement.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const symbol = scopes.symbolFor(specifier.local);
      if (!symbol || symbol.references.length === 0) return false;
      if (
        !symbol.references.every(({ identifier, flag }) => {
          if (flag !== "read") return false;
          if (identifier === baseReference) return true;
          const parent = identifier.parent;
          return (
            isNodeOfType(identifier, "JSXIdentifier") &&
            (isNodeOfType(parent, "JSXOpeningElement") ||
              isNodeOfType(parent, "JSXClosingElement")) &&
            parent.name === identifier
          );
        })
      ) {
        return false;
      }
    }
  }
  return true;
};

const isEmptyOrLoggingCatch = (
  handler: EsTreeNodeOfType<"CatchClause">,
  scopes: ScopeAnalysis,
): boolean => {
  const statements = handler.body.body;
  if (statements.length === 0) return true;
  if (statements.length !== 1) return false;
  const expression = getStatementExpression(statements[0]);
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    !isNodeOfType(expression.callee, "MemberExpression") ||
    expression.callee.computed ||
    expression.callee.optional ||
    !CONSOLE_LOG_METHOD_NAMES.has(getStaticPropertyName(expression.callee) ?? "") ||
    !isNodeOfType(expression.callee.object, "Identifier") ||
    expression.callee.object.name !== "console" ||
    !scopes.isGlobalReference(expression.callee.object)
  ) {
    return false;
  }
  const errorSymbol = isNodeOfType(handler.param, "Identifier")
    ? scopes.symbolFor(handler.param)
    : null;
  return expression.arguments.every(
    (argument) =>
      isNodeOfType(argument, "Literal") ||
      (isNodeOfType(argument, "Identifier") &&
        errorSymbol !== null &&
        scopes.symbolFor(argument) === errorSymbol),
  );
};

const hasVisibleClassProviderMutation = (scopes: ScopeAnalysis): boolean =>
  someAst(scopes.rootScope.node, (node) => {
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration")
    ) {
      return true;
    }
    if (isNodeOfType(node, "Identifier")) {
      if (DYNAMIC_PROVIDER_NAMES.has(node.name) && scopes.isGlobalReference(node)) return true;
      const isDocument = node.name === "document" && scopes.isGlobalReference(node);
      if (!isDocument && !isProvenGlobalObjectReference(node, scopes)) return false;
      const reference = findTransparentExpressionRoot(node);
      const use = reference.parent;
      if (!isNodeOfType(use, "MemberExpression") || use.object !== reference) {
        return true;
      }
      const property = getResolvedStaticPropertyName(use, scopes);
      return property === null || GLOBAL_PROVIDER_NAMES.has(property);
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      return PROTOTYPE_ACCESS_NAMES.has(getResolvedStaticPropertyName(node, scopes) ?? "");
    }
    if (!isNodeOfType(node, "MemberExpression")) return false;
    const property = getResolvedStaticPropertyName(node, scopes);
    return (
      PROTOTYPE_ACCESS_NAMES.has(property ?? "") ||
      ((property === "setState" || property === "fetch") && isWithinAssignmentTarget(node))
    );
  });

export const getSuccessOnlyClassMountLoadingReset = (
  classNode: EsTreeNodeOfType<"ClassDeclaration">,
  scopes: ScopeAnalysis,
  loadingFlagPattern: RegExp,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (classNode.decorators?.length || !isDirectReactBase(classNode, scopes)) return null;
  const classSymbol = classNode.id && scopes.symbolFor(classNode.id);
  if (
    !classSymbol ||
    classSymbol.declarationNode !== classNode ||
    classSymbol.references.some(({ identifier, flag }) => {
      const use = identifier.parent;
      return (
        flag !== "read" ||
        !(
          (isNodeOfType(use, "ExportDefaultDeclaration") && use.declaration === identifier) ||
          (isNodeOfType(use, "ExportSpecifier") && use.local === identifier)
        )
      );
    })
  ) {
    return null;
  }
  const methods = new Map<string, EsTreeNodeOfType<"FunctionExpression">>();
  for (const member of classNode.body.body) {
    if (
      !isNodeOfType(member, "MethodDefinition") ||
      member.computed ||
      member.static ||
      member.decorators?.length ||
      (member.kind !== "method" && member.kind !== "constructor") ||
      !isNodeOfType(member.value, "FunctionExpression") ||
      member.value.async ||
      member.value.generator
    ) {
      return null;
    }
    const name = getStaticPropertyKeyName(member);
    if (!name || !MOUNT_LOADING_METHOD_NAMES.has(name) || methods.has(name)) return null;
    methods.set(name, member.value);
  }
  const constructor = methods.get("constructor");
  const mount = methods.get("componentDidMount");
  const render = methods.get("render");
  if (!constructor || !mount || !render) return null;
  const constructorStatements = constructor.body.body;
  if (constructorStatements.length !== 2) return null;
  const superCall = getStatementExpression(constructorStatements[0]);
  const stateAssignment = getStatementExpression(constructorStatements[1]);
  if (
    !isNodeOfType(superCall, "CallExpression") ||
    !isNodeOfType(superCall.callee, "Super") ||
    !isNodeOfType(stateAssignment, "AssignmentExpression") ||
    stateAssignment.operator !== "=" ||
    !isDirectThisMember(stateAssignment.left, "state")
  ) {
    return null;
  }
  const initialState = getDataProperties(stateAssignment.right);
  if (
    !initialState ||
    [...initialState.values()].some((value) => !isNodeOfType(value, "Literal"))
  ) {
    return null;
  }

  const mountStatements = mount.body.body.filter(
    (statement) => !isNodeOfType(statement, "EmptyStatement"),
  );
  if (mountStatements.length !== 1) return null;
  const invocation = getStatementExpression(mountStatements[0]);
  if (
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.optional ||
    invocation.arguments.length
  ) {
    return null;
  }
  const callback = stripParenExpression(invocation.callee);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    !callback.async ||
    callback.params.length ||
    findImmediatelyInvokedCallExpression(callback) !== invocation ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 1
  ) {
    return null;
  }
  const attempt = callback.body.body[0];
  if (
    !isNodeOfType(attempt, "TryStatement") ||
    !attempt.handler ||
    attempt.finalizer ||
    attempt.block.body.length !== 3 ||
    !isEmptyOrLoggingCatch(attempt.handler, scopes)
  ) {
    return null;
  }
  const [fetchStatement, decodeStatement, resetStatement] = attempt.block.body;
  const response = getSingleAwaitedCall(fetchStatement, scopes);
  const payload = getSingleAwaitedCall(decodeStatement, scopes);
  const reset = getStatementExpression(resetStatement);
  if (!response || !payload || !isNodeOfType(reset, "CallExpression") || reset.optional)
    return null;
  const fetchCallee = stripParenExpression(response.call.callee);
  const url = response.call.arguments[0];
  const decode = stripParenExpression(payload.call.callee);
  if (
    !isNodeOfType(fetchCallee, "Identifier") ||
    fetchCallee.name !== "fetch" ||
    response.call.arguments.length !== 1 ||
    !isNodeOfType(url, "Literal") ||
    typeof url.value !== "string" ||
    !NETWORK_URL_PATTERN.test(url.value) ||
    !isProvenUnmodifiedGlobalNamespaceReference(fetchCallee, "fetch", scopes, undefined, true) ||
    !isNodeOfType(decode, "MemberExpression") ||
    decode.computed ||
    decode.optional ||
    getStaticPropertyName(decode) !== "json" ||
    !isNodeOfType(decode.object, "Identifier") ||
    scopes.symbolFor(decode.object) !== response.symbol ||
    payload.call.arguments.length ||
    !isDirectThisMember(reset.callee, "setState") ||
    reset.arguments.length !== 1
  ) {
    return null;
  }
  const patch = getDataProperties(reset.arguments[0]);
  if (!patch) return null;
  const flags: string[] = [];
  for (const [key, value] of patch) {
    if (isNodeOfType(value, "Identifier") && scopes.symbolFor(value) === payload.symbol) {
      continue;
    }
    if (!isNodeOfType(value, "Literal")) return null;
    const initial = initialState.get(key);
    if (
      value.value === false &&
      isNodeOfType(initial, "Literal") &&
      initial.value === true &&
      loadingFlagPattern.test(key)
    ) {
      flags.push(key);
    }
  }
  if (
    flags.length !== 1 ||
    !classNode.superClass ||
    !hasClosedClassProviderImports(stripParenExpression(classNode.superClass), scopes) ||
    hasVisibleClassProviderMutation(scopes)
  ) {
    return null;
  }

  let renderReadsFlag = false;
  const hasOpenInstanceReference = someAst(classNode, (node) => {
    if (!isNodeOfType(node, "ThisExpression")) return false;
    const member = node.parent;
    if (member === stateAssignment.left || member === reset.callee) return false;
    if (!isDirectThisMember(member, "state") || !member || !isAstDescendant(member, render)) {
      return true;
    }
    const projection = member.parent;
    if (
      !isNodeOfType(projection, "MemberExpression") ||
      projection.object !== member ||
      projection.computed ||
      projection.optional ||
      isWithinAssignmentTarget(projection)
    ) {
      return true;
    }
    if (getStaticPropertyName(projection) === flags[0]) renderReadsFlag = true;
    return false;
  });
  return !hasOpenInstanceReference && renderReadsFlag ? reset : null;
};
