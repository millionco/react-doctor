import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

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
const PRODUCT_API_KEY_COLLECTION_PATTERN = /[._:-](?:created|generated|saved)[-_]?api[-_]?keys$/i;

const isAuthCredentialKey = (key: string): boolean => {
  if (!SENSITIVE_KEY_PATTERN.test(key)) return false;
  if (PRODUCT_API_KEY_COLLECTION_PATTERN.test(key)) return false;
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

// Also resolves one level of aliasing: `const storage = window.localStorage`
// then `storage.setItem(...)` — the binding provably IS web storage.
const isWebStorageObject = (node: EsTreeNode): boolean => {
  if (isDirectWebStorageObject(node)) return true;
  if (!isNodeOfType(node, "Identifier")) return false;
  const binding = findVariableInitializer(node, node.name);
  return binding?.initializer ? isDirectWebStorageObject(binding.initializer) : false;
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

export const authTokenInWebStorage = defineRule({
  id: "auth-token-in-web-storage",
  title: "Auth token in web storage",
  severity: "warn",
  recommendation:
    "Don't persist auth tokens (JWTs, access/refresh tokens, secrets) in `localStorage`/`sessionStorage`; they're readable by any XSS. Use an `HttpOnly` cookie set by the server.",
  create: skipNonProductionFiles((context) => ({
    // `localStorage.setItem("authToken", t)`
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "setItem")
        return;
      if (!isWebStorageObject(stripParenExpression(callee.object))) return;
      const keyArgument = node.arguments?.[0];
      if (!keyArgument) return;
      const keyString = resolveStaticKeyString(keyArgument);
      if (keyString === null || !isAuthCredentialKey(keyString)) return;
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
