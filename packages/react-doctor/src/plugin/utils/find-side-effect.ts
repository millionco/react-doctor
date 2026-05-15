import { MUTATING_HTTP_METHODS, MUTATION_METHOD_NAMES } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { walkAst } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";

// HACK: extracted so `findSideEffect` can re-use the EXACT same shape
// predicate when it goes hunting for the literal method to render in
// the diagnostic. Previously `findSideEffect` used a looser `key.name
// === "method"` predicate and could pick a non-Literal `method:` entry
// (when duplicate keys are present), producing
// `"fetch() with method undefined"` in the message.
const isMutatingMethodProperty = (property: EsTreeNode): boolean =>
  isNodeOfType(property, "Property") &&
  isNodeOfType(property.key, "Identifier") &&
  property.key.name === "method" &&
  isNodeOfType(property.value, "Literal") &&
  typeof property.value.value === "string" &&
  MUTATING_HTTP_METHODS.has(property.value.value.toUpperCase());

const isCookiesOrHeadersCall = (node: EsTreeNode, methodName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression"))
    return false;
  const { object, property } = node.callee;
  if (!isNodeOfType(property, "Identifier") || !MUTATION_METHOD_NAMES.has(property.name))
    return false;
  if (!isNodeOfType(object, "CallExpression") || !isNodeOfType(object.callee, "Identifier"))
    return false;
  return object.callee.name === methodName;
};

const isMutatingDbCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression"))
    return false;
  const { property } = node.callee;
  return isNodeOfType(property, "Identifier") && MUTATION_METHOD_NAMES.has(property.name);
};

const isMutatingFetchCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "fetch") return false;
  const optionsArgument = node.arguments?.[1];
  if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return false;
  return Boolean(optionsArgument.properties?.some(isMutatingMethodProperty));
};

const getCookiesOrHeadersMethodName = (
  child: EsTreeNode,
  apiName: "cookies" | "headers",
): string | null => {
  if (!isCookiesOrHeadersCall(child, apiName)) return null;
  if (!isNodeOfType(child, "CallExpression")) return null;
  if (!isNodeOfType(child.callee, "MemberExpression")) return null;
  if (!isNodeOfType(child.callee.property, "Identifier")) return null;
  return child.callee.property.name;
};

export const findSideEffect = (node: EsTreeNode): string | null => {
  let sideEffectDescription: string | null = null;
  walkAst(node, (child: EsTreeNode) => {
    if (sideEffectDescription) return;
    const cookiesMethodName = getCookiesOrHeadersMethodName(child, "cookies");
    if (cookiesMethodName) {
      sideEffectDescription = `cookies().${cookiesMethodName}()`;
      return;
    }
    const headersMethodName = getCookiesOrHeadersMethodName(child, "headers");
    if (headersMethodName) {
      sideEffectDescription = `headers().${headersMethodName}()`;
      return;
    }
    if (isMutatingFetchCall(child) && isNodeOfType(child, "CallExpression")) {
      // HACK: re-use the EXACT predicate `isMutatingFetchCall` already
      // matched on so we can't pick a non-Literal duplicate `method:`
      // entry by mistake (a looser `key.name === "method"` predicate
      // would).
      const optionsArgument = child.arguments[1];
      if (!isNodeOfType(optionsArgument, "ObjectExpression")) return;
      const methodProperty = optionsArgument.properties.find(isMutatingMethodProperty);
      if (
        !methodProperty ||
        !isNodeOfType(methodProperty, "Property") ||
        !isNodeOfType(methodProperty.value, "Literal")
      )
        return;
      sideEffectDescription = `fetch() with method ${methodProperty.value.value}`;
    } else if (isMutatingDbCall(child) && isNodeOfType(child, "CallExpression")) {
      if (!isNodeOfType(child.callee, "MemberExpression")) return;
      if (!isNodeOfType(child.callee.property, "Identifier")) return;
      const methodName = child.callee.property.name;
      const objectName = isNodeOfType(child.callee.object, "Identifier")
        ? child.callee.object.name
        : null;
      sideEffectDescription = objectName ? `${objectName}.${methodName}()` : `.${methodName}()`;
    }
  });
  return sideEffectDescription;
};
