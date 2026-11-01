import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { HTML_TAGS, VOID_DOM_ELEMENTS } from "../../../constants/html-tags.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import {
  REF_NOTIFICATION_INACTIVE_ATTRIBUTES,
  REF_NOTIFICATION_INACTIVE_CONTENT_TAGS,
} from "./constants.js";

export const isRefNotificationNativeElement = (
  element: EsTreeNodeOfType<"JSXElement">,
  scopes: ScopeAnalysis,
  requiresContent: boolean,
): boolean => {
  const opening = element.openingElement;
  const name = resolveJsxElementType(opening);
  return (
    isNodeOfType(opening.name, "JSXIdentifier") &&
    /^[a-z]/.test(opening.name.name) &&
    HTML_TAGS.has(name) &&
    isProvenIntrinsicJsxElement(opening, scopes) &&
    (!REF_NOTIFICATION_INACTIVE_CONTENT_TAGS.has(name) ||
      (!requiresContent && name === "textarea")) &&
    (!requiresContent || !VOID_DOM_ELEMENTS.has(name)) &&
    opening.attributes.every(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        !REF_NOTIFICATION_INACTIVE_ATTRIBUTES.has(getJsxAttributeName(attribute.name) ?? ""),
    )
  );
};
