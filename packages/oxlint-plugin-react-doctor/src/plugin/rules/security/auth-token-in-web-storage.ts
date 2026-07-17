import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { stripThisParameter } from "../../utils/strip-this-parameter.js";
import { walkAst } from "../../utils/walk-ast.js";

interface StorageHelperSink {
  keyParameterIndex: number;
  valueParameterIndex: number;
}

const MESSAGE =
  "Storing an auth token in `localStorage`/`sessionStorage` exposes it to any XSS on the page: JavaScript can read web storage and exfiltrate the token. Keep tokens in an `HttpOnly`, `Secure`, `SameSite` cookie instead.";

const STORAGE_NAMES = new Set(["localStorage", "sessionStorage"]);
const STORAGE_GLOBALS = new Set(["window", "globalThis", "self"]);

// Curated, high-signal token words. Deliberately excludes broad terms like
// `auth`, `session`, and bare `key`, which routinely name non-secret flags
// (`isAuthenticated`, `sessionStart`, `apiKeyName`) and would add noise.
const SENSITIVE_KEY_PATTERN =
  /token|jwt|secret|password|passwd|credential|api[-_]?key|bearer|private[-_]?key/i;

// `token` over-matches names that aren't auth/session credentials. CSRF/XSRF
// double-submit tokens are *intentionally* JS-readable (the sibling
// `insecure-session-cookie` rule carves them out too), FCM/APNs/push device
// tokens are routing identifiers, and design-tokens / tokenizer / syntax
// configs (`designTokens`, `tokenizerConfig`, `tokenColors`, `syntaxTokens`)
// are styling data, not credentials. Exempt those unless the key ALSO carries
// a strong auth signal (so `deviceAccessToken` still fires).
const NON_AUTH_TOKEN_PATTERN =
  /csrf|xsrf|device|fcm|apns|push|design|tokeniz|syntax|css|theme|color/i;
const STRONG_AUTH_KEY_PATTERN =
  /jwt|secret|password|passwd|credential|private[-_]?key|api[-_]?key|bearer|access[-_]?token|refresh[-_]?token|auth[-_]?token|id[-_]?token|session/i;
const isAuthCredentialKey = (key: string): boolean => {
  if (!SENSITIVE_KEY_PATTERN.test(key)) return false;
  if (NON_AUTH_TOKEN_PATTERN.test(key) && !STRONG_AUTH_KEY_PATTERN.test(key)) return false;
  return true;
};

// `localStorage` / `sessionStorage`, optionally reached through a global
// (`window.localStorage`, `globalThis.sessionStorage`).
const isDirectWebStorageObject = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Identifier")) return STORAGE_NAMES.has(node.name);
  if (
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    isNodeOfType(node.object, "Identifier") &&
    STORAGE_GLOBALS.has(node.object.name) &&
    isNodeOfType(node.property, "Identifier")
  ) {
    return STORAGE_NAMES.has(node.property.name);
  }
  return false;
};

const immutableInitializer = (
  identifier: EsTreeNodeOfType<"Identifier">,
  visitedIdentifiers = new Set<EsTreeNode>(),
): EsTreeNode | null => {
  if (visitedIdentifiers.has(identifier)) return null;
  visitedIdentifiers.add(identifier);
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding?.initializer) return null;
  if (isNodeOfType(binding.initializer, "FunctionDeclaration")) return binding.initializer;
  const declarator = binding.bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
  if (declaration.kind !== "const") return null;
  const initializer = stripParenExpression(binding.initializer);
  if (!isNodeOfType(initializer, "Identifier")) return initializer;
  return immutableInitializer(initializer, visitedIdentifiers) ?? initializer;
};

const isWebStorageFactoryResult = (
  node: EsTreeNode,
  visitedNodes: ReadonlySet<EsTreeNode>,
): boolean => {
  const expression = stripParenExpression(node);
  if (isWebStorageObject(expression, new Set(visitedNodes))) return true;
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const consequent = stripParenExpression(expression.consequent);
    const alternate = stripParenExpression(expression.alternate);
    return (
      (isNullishExpression(consequent) || isWebStorageFactoryResult(consequent, visitedNodes)) &&
      (isNullishExpression(alternate) || isWebStorageFactoryResult(alternate, visitedNodes)) &&
      (!isNullishExpression(consequent) || !isNullishExpression(alternate))
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator === "&&") {
      return isWebStorageFactoryResult(expression.right, visitedNodes);
    }
    const left = stripParenExpression(expression.left);
    const right = stripParenExpression(expression.right);
    const isLeftStorage = isWebStorageFactoryResult(left, visitedNodes);
    const isRightStorage = isWebStorageFactoryResult(right, visitedNodes);
    return (
      (isLeftStorage || isNullishExpression(left)) &&
      (isRightStorage || isNullishExpression(right)) &&
      (isLeftStorage || isRightStorage)
    );
  }
  return false;
};

const isWebStorageObject = (node: EsTreeNode, visitedNodes = new Set<EsTreeNode>()): boolean => {
  const expression = stripParenExpression(node);
  if (visitedNodes.has(expression)) return false;
  visitedNodes.add(expression);
  if (isDirectWebStorageObject(expression)) return true;
  if (isNodeOfType(expression, "Identifier")) {
    const initializer = immutableInitializer(expression);
    return initializer ? isWebStorageObject(initializer, new Set(visitedNodes)) : false;
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const factory = immutableInitializer(callee);
  if (!isFunctionLike(factory)) return false;
  if (
    isNodeOfType(factory, "ArrowFunctionExpression") &&
    !isNodeOfType(factory.body, "BlockStatement")
  ) {
    return isWebStorageFactoryResult(factory.body, visitedNodes);
  }
  let didReturnWebStorage = false;
  for (const returnStatement of collectFunctionReturnStatements(factory)) {
    if (!returnStatement.argument) continue;
    const strippedReturn = stripParenExpression(returnStatement.argument);
    if (isNullishExpression(strippedReturn)) continue;
    if (!isWebStorageFactoryResult(strippedReturn, visitedNodes)) return false;
    didReturnWebStorage = true;
  }
  return didReturnWebStorage;
};

// Static string value of a key expression: a string literal, a
// substitution-free template literal (`` `accessToken` `` — equivalent to
// a string literal), or an identifier whose same-file declaration
// initializer is one of those (`const TOKEN_STORAGE_KEY = "auth_token"`).
const resolveStaticKeyString = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Literal") && typeof node.value === "string") return node.value;
  if (isNodeOfType(node, "TemplateLiteral") && (node.expressions ?? []).length === 0) {
    const cooked = (node.quasis ?? [])[0]?.value?.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  if (isNodeOfType(node, "Identifier") && node.name !== "undefined") {
    const binding = findVariableInitializer(node, node.name);
    if (!binding?.initializer || isNodeOfType(binding.initializer, "Identifier")) return null;
    return resolveStaticKeyString(binding.initializer);
  }
  return null;
};

// Static property name of a member access: `store.token` → "token",
// `store["token"]` → "token", `store[expr]` → null (dynamic, unknown).
const staticMemberName = (member: EsTreeNodeOfType<"MemberExpression">): string | null => {
  if (!member.computed && isNodeOfType(member.property, "Identifier")) return member.property.name;
  if (
    member.computed &&
    isNodeOfType(member.property, "Literal") &&
    typeof member.property.value === "string"
  ) {
    return member.property.value;
  }
  return null;
};

const parameterIndex = (
  expression: EsTreeNode,
  parameterSymbolIds: Array<number | null>,
  scopes: ScopeAnalysis,
  canUnwrapSerialization: boolean,
  visitedNodes = new Set<EsTreeNode>(),
): number | null => {
  const strippedExpression = stripParenExpression(expression);
  if (visitedNodes.has(strippedExpression)) return null;
  visitedNodes.add(strippedExpression);
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const directSymbolId = scopes.symbolFor(strippedExpression)?.id;
    const directIndex =
      directSymbolId === undefined ? -1 : parameterSymbolIds.indexOf(directSymbolId);
    if (directIndex !== -1) return directIndex;
    const initializer = immutableInitializer(strippedExpression);
    return initializer
      ? parameterIndex(
          initializer,
          parameterSymbolIds,
          scopes,
          canUnwrapSerialization,
          visitedNodes,
        )
      : null;
  }
  if (
    canUnwrapSerialization &&
    isNodeOfType(strippedExpression, "CallExpression") &&
    isNodeOfType(strippedExpression.callee, "MemberExpression") &&
    !strippedExpression.callee.computed &&
    isNodeOfType(strippedExpression.callee.object, "Identifier") &&
    strippedExpression.callee.object.name === "JSON" &&
    isNodeOfType(strippedExpression.callee.property, "Identifier") &&
    strippedExpression.callee.property.name === "stringify"
  ) {
    const serializedArgument = strippedExpression.arguments[0];
    return serializedArgument
      ? parameterIndex(serializedArgument, parameterSymbolIds, scopes, true, visitedNodes)
      : null;
  }
  return null;
};

const storageHelperSinkCache = new WeakMap<EsTreeNode, readonly StorageHelperSink[]>();

const findStorageHelperSinks = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): readonly StorageHelperSink[] => {
  const cachedSinks = storageHelperSinkCache.get(functionNode);
  if (cachedSinks) return cachedSinks;
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    storageHelperSinkCache.set(functionNode, []);
    return [];
  }
  const runtimeParameters = stripThisParameter(functionNode.params);
  const parameterSymbolIds = runtimeParameters.map((parameter) => {
    const strippedParameter = stripParenExpression(parameter);
    const identifier = isNodeOfType(strippedParameter, "Identifier")
      ? strippedParameter
      : isNodeOfType(strippedParameter, "AssignmentPattern") &&
          isNodeOfType(strippedParameter.left, "Identifier")
        ? strippedParameter.left
        : null;
    return identifier ? (scopes.symbolFor(identifier)?.id ?? null) : null;
  });
  const helperSinks: StorageHelperSink[] = [];
  walkAst(functionNode.body, (child) => {
    if (child !== functionNode.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      !isNodeOfType(callee.property, "Identifier") ||
      callee.property.name !== "setItem" ||
      !isWebStorageObject(callee.object)
    ) {
      return;
    }
    const keyExpression = child.arguments[0];
    const valueExpression = child.arguments[1];
    if (!keyExpression || !valueExpression) return;
    const keyParameterIndex = parameterIndex(keyExpression, parameterSymbolIds, scopes, false);
    const valueParameterIndex = parameterIndex(valueExpression, parameterSymbolIds, scopes, true);
    if (keyParameterIndex === null || valueParameterIndex === null) return;
    helperSinks.push({ keyParameterIndex, valueParameterIndex });
  });
  storageHelperSinkCache.set(functionNode, helperSinks);
  return helperSinks;
};

export const authTokenInWebStorage = defineRule({
  id: "auth-token-in-web-storage",
  title: "Auth token in web storage",
  severity: "warn",
  recommendation:
    "Don't persist auth tokens (JWTs, access/refresh tokens, secrets) in `localStorage`/`sessionStorage`; they're readable by any XSS. Use an `HttpOnly` cookie set by the server.",
  create: skipNonProductionFiles((context) => ({
    // `localStorage.setItem("authToken", t)`
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = stripParenExpression(node.callee);
      const keyArguments: EsTreeNode[] = [];
      if (
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "setItem" &&
        isWebStorageObject(stripParenExpression(callee.object))
      ) {
        const keyArgument = node.arguments[0];
        if (keyArgument) keyArguments.push(keyArgument);
      } else if (isNodeOfType(callee, "Identifier")) {
        const helperFunction = immutableInitializer(callee);
        const helperSinks = helperFunction
          ? findStorageHelperSinks(helperFunction, context.scopes)
          : [];
        for (const helperSink of helperSinks) {
          const keyArgument = node.arguments[helperSink.keyParameterIndex];
          if (keyArgument && node.arguments[helperSink.valueParameterIndex]) {
            keyArguments.push(keyArgument);
          }
        }
      }
      const hasCredentialKey = keyArguments.some((keyArgument) => {
        const keyString = resolveStaticKeyString(keyArgument);
        return keyString !== null && isAuthCredentialKey(keyString);
      });
      if (!hasCredentialKey) return;
      context.report({ node, message: MESSAGE });
    },
    // `localStorage.authToken = t` / `localStorage["jwt"] = t`
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const target = node.left;
      if (!isNodeOfType(target, "MemberExpression")) return;
      if (!isWebStorageObject(target.object)) return;
      const propertyName = staticMemberName(target);
      if (!propertyName || !isAuthCredentialKey(propertyName)) return;
      context.report({ node: target, message: MESSAGE });
    },
  })),
});
