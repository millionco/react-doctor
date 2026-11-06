import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { hasPossibleNativeFetchPrototypeMutation } from "./has-possible-native-fetch-prototype-mutation.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  hasPossibleGlobalNamespaceMutationOrPrototypeAccess,
  isProvenUnmodifiedGlobalNamespaceReference,
} from "./is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const SIMPLE_REQUEST_INIT_KEYS = new Set([
  "body",
  "cache",
  "credentials",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "priority",
  "redirect",
  "referrer",
  "referrerPolicy",
]);

const isStringFetchInput = (input: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let expression = stripParenExpression(input);
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(expression, scopes);
    const initializer = symbol ? getDirectConstInitializer(symbol) : null;
    if (!symbol || !initializer || !isSymbolReadOnly(symbol)) return false;
    expression = stripParenExpression(initializer);
  }
  return (
    isNodeOfType(expression, "TemplateLiteral") || getStaticStringExpression(expression) !== null
  );
};

const hasOnlyStaticDataProperties = (
  expression: EsTreeNode,
  isAllowedProperty: (key: string, value: EsTreeNode) => boolean,
): boolean => {
  const object = stripParenExpression(expression);
  return (
    isNodeOfType(object, "ObjectExpression") &&
    object.properties.every((property) => {
      if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method) {
        return false;
      }
      const key = getStaticPropertyKeyName(property, { allowComputedString: true });
      return (
        key !== null &&
        key !== "__proto__" &&
        isAllowedProperty(key, stripParenExpression(property.value))
      );
    })
  );
};

const isSimpleRequestInitWithoutSignal = (expression: EsTreeNode): boolean =>
  hasOnlyStaticDataProperties(expression, (key, value) => {
    if (key === "headers") {
      return hasOnlyStaticDataProperties(
        value,
        (_header, headerValue) => getStaticStringExpression(headerValue) !== null,
      );
    }
    return (
      SIMPLE_REQUEST_INIT_KEYS.has(key) &&
      isNodeOfType(value, "Literal") &&
      (value.value === null ||
        typeof value.value === "string" ||
        typeof value.value === "boolean" ||
        typeof value.value === "number")
    );
  });

export const isProvenNativeFetchWithoutSignal = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (call.optional || call.arguments.length > 2) return false;
  const [input, init] = call.arguments;
  return (
    Boolean(input && isStringFetchInput(input, scopes)) &&
    (!init || isSimpleRequestInitWithoutSignal(init)) &&
    isProvenUnmodifiedGlobalNamespaceReference(call.callee, "fetch", scopes, undefined, true) &&
    !hasPossibleGlobalNamespaceMutationOrPrototypeAccess("Object", scopes) &&
    !hasPossibleGlobalNamespaceMutationOrPrototypeAccess("Promise", scopes) &&
    !hasPossibleNativeFetchPrototypeMutation(scopes)
  );
};
