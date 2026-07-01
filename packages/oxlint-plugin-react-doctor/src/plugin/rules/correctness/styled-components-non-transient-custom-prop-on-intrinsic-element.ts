import {
  DOM_PROPERTY_NAMES,
  DOM_PROPERTY_NAMES_LOWER,
} from "../../constants/dom-property-names.js";
import { DOM_PROPERTY_TO_ALLOWED_TAGS } from "../../constants/dom-property-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// Attributes that live in the global known-attribute set but are only
// valid on specific elements, and are NOT already scoped by
// `DOM_PROPERTY_TO_ALLOWED_TAGS`. Keeps `styled.div<{ selected }>` (a real
// leak — `selected` belongs on `<option>`) flaggable without touching the
// shared no-unknown-property tables.
const ELEMENT_RESTRICTED_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["selected", new Set(["option"])],
]);

const EVENT_HANDLER_PROP_PATTERN = /^on[A-Z]/;

interface StyledIntrinsicTag {
  readonly tagName: string;
}

// `styled.div` / `styled.button` — a non-computed `.<lowercase>` member off
// the `styled` identifier. `styled(Component)`, `styled.div.attrs(...)`, and
// `withConfig(...)` all produce a CallExpression tag, so they never match
// here — matching the "only intrinsic, un-stripped" scope.
const readStyledIntrinsicTag = (tag: EsTreeNode): StyledIntrinsicTag | null => {
  if (!isNodeOfType(tag, "MemberExpression") || tag.computed) return null;
  if (!isNodeOfType(tag.object, "Identifier") || tag.object.name !== "styled") return null;
  if (!isNodeOfType(tag.property, "Identifier")) return null;
  const firstCharacterCode = tag.property.name.charCodeAt(0);
  if (firstCharacterCode < 97 || firstCharacterCode > 122) return null;
  return { tagName: tag.property.name };
};

const getPropertySignatureName = (member: EsTreeNode): string | null => {
  if (!isNodeOfType(member, "TSPropertySignature") || member.computed) return null;
  if (isNodeOfType(member.key, "Identifier")) return member.key.name;
  if (isNodeOfType(member.key, "Literal") && typeof member.key.value === "string") {
    return member.key.value;
  }
  return null;
};

const isKnownAttributeName = (propName: string): boolean =>
  DOM_PROPERTY_NAMES.has(propName) ||
  DOM_PROPERTY_NAMES_LOWER.has(propName.toLowerCase()) ||
  DOM_PROPERTY_TO_ALLOWED_TAGS.has(propName) ||
  ELEMENT_RESTRICTED_ATTRIBUTES.has(propName);

const allowedTagsFor = (propName: string): ReadonlySet<string> | null =>
  ELEMENT_RESTRICTED_ATTRIBUTES.get(propName) ?? DOM_PROPERTY_TO_ALLOWED_TAGS.get(propName) ?? null;

// A prop is safely forwardable to the DOM node when it's transient (`$`),
// a data-*/aria-* attribute, an event handler, or a known attribute that is
// valid on this element. Everything else reaches the DOM node verbatim.
const isForwardableToTag = (propName: string, tagName: string): boolean => {
  if (propName.startsWith("$")) return true;
  if (propName.startsWith("data-") || propName.startsWith("aria-")) return true;
  if (EVENT_HANDLER_PROP_PATTERN.test(propName)) return true;
  if (!isKnownAttributeName(propName)) return false;
  const allowedTags = allowedTagsFor(propName);
  return allowedTags === null || allowedTags.has(tagName);
};

export const styledComponentsNonTransientCustomPropOnIntrinsicElement = defineRule({
  id: "styled-components-non-transient-custom-prop-on-intrinsic-element",
  title: "Non-transient custom prop on styled intrinsic element",
  severity: "warn",
  requires: ["styled-components"],
  recommendation:
    "Prefix custom styled-components props with `$` (e.g. `$active`) so styled-components v6 keeps them off the DOM node instead of forwarding them as invalid attributes.",
  create: (context) => ({
    TaggedTemplateExpression(node: EsTreeNodeOfType<"TaggedTemplateExpression">) {
      const intrinsic = readStyledIntrinsicTag(node.tag);
      if (!intrinsic) return;
      const typeArguments = node.typeArguments;
      if (!typeArguments || typeArguments.params.length === 0) return;
      const typeLiteral = typeArguments.params[0];
      if (!isNodeOfType(typeLiteral, "TSTypeLiteral")) return;

      for (const member of typeLiteral.members) {
        const propName = getPropertySignatureName(member);
        if (!propName || isForwardableToTag(propName, intrinsic.tagName)) continue;
        context.report({
          node: member,
          message: `styled-components v6 forwards the custom prop \`${propName}\` to the <${intrinsic.tagName}> DOM node, producing a React unknown-prop warning — prefix it with \`$\` to make it transient.`,
        });
      }
    },
  }),
});
