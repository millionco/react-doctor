import type { EsTreeNode } from "./es-tree-node.js";
import { isCookiesOrHeadersCall } from "./is-cookies-or-headers-call.js";
import { isMutatingDbCall } from "./is-mutating-db-call.js";
import { isMutatingFetchCall } from "./is-mutating-fetch-call.js";
import { isMutatingMethodProperty } from "./is-mutating-method-property.js";
import { walkAst } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";

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
