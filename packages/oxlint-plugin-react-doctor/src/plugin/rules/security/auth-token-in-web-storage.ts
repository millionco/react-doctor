import { defineRule } from "../../utils/define-rule.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

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
const isWebStorageObject = (node: EsTreeNode): boolean => {
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
      if (!isWebStorageObject(callee.object)) return;
      const keyArgument = node.arguments?.[0];
      if (
        !keyArgument ||
        !isNodeOfType(keyArgument, "Literal") ||
        typeof keyArgument.value !== "string"
      ) {
        return;
      }
      if (!isAuthCredentialKey(keyArgument.value)) return;
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
