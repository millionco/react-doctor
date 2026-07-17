import {
  DOM_PROPERTY_NAMES,
  DOM_PROPERTY_NAMES_LOWER,
} from "../../constants/dom-property-names.js";
import { DOM_PROPERTY_TO_ALLOWED_TAGS } from "../../constants/dom-property-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

const TYPE_RESOLUTION_DEPTH_LIMIT = 3;

// Attributes that live in the global known-attribute set but are only
// valid on specific elements, and are NOT already scoped by
// `DOM_PROPERTY_TO_ALLOWED_TAGS`. Keeps `styled.div<{ selected }>` (a real
// leak — `selected` belongs on `<option>`) flaggable without touching the
// shared no-unknown-property tables.
const ELEMENT_RESTRICTED_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["selected", new Set(["option"])],
]);

const EVENT_HANDLER_PROP_PATTERN = /^on[A-Z]/;

// Props styled-components consumes internally (v6 createStyledComponent
// skips them when building the element's props), so they never reach the
// DOM node and prefixing them with `$` would break their behavior.
const STYLED_COMPONENTS_CONSUMED_PROPS: ReadonlySet<string> = new Set([
  "theme",
  "as",
  "forwardedAs",
]);

interface StyledIntrinsicTag {
  readonly tagName: string;
}

// Unwraps `.attrs(...)` chains — `.attrs()` merges attributes and strips
// nothing, so `styled.div.attrs({...})` is still an intrinsic target whose
// non-transient custom props forward to the DOM. `withConfig(...)` stays
// opaque because `shouldForwardProp` can legitimately filter the prop.
const unwrapAttrsCalls = (tag: EsTreeNode): EsTreeNode => {
  let current = tag;
  while (
    isNodeOfType(current, "CallExpression") &&
    isNodeOfType(current.callee, "MemberExpression") &&
    !current.callee.computed &&
    isNodeOfType(current.callee.property, "Identifier") &&
    current.callee.property.name === "attrs"
  ) {
    current = current.callee.object;
  }
  return current;
};

// `styled.div` / `styled.button` — a non-computed `.<lowercase>` member off
// the `styled` identifier, optionally behind `.attrs(...)` calls.
// `styled(Component)` and `withConfig(...)` produce non-matching shapes,
// so they never match here — matching the "only intrinsic, un-stripped"
// scope.
const readStyledIntrinsicTag = (tag: EsTreeNode): StyledIntrinsicTag | null => {
  const base = unwrapAttrsCalls(tag);
  if (!isNodeOfType(base, "MemberExpression") || base.computed) return null;
  if (!isNodeOfType(base.object, "Identifier") || base.object.name !== "styled") return null;
  if (!isNodeOfType(base.property, "Identifier")) return null;
  const firstCharacterCode = base.property.name.charCodeAt(0);
  if (firstCharacterCode < 97 || firstCharacterCode > 122) return null;
  return { tagName: base.property.name };
};

const findSameFileTypeDeclaration = (
  referenceNode: EsTreeNode,
  typeName: string,
): EsTreeNode | null => {
  const programRoot = findProgramRoot(referenceNode);
  if (!programRoot) return null;
  for (const statement of programRoot.body) {
    const declaration: EsTreeNode | null = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    if (!declaration) continue;
    if (
      (isNodeOfType(declaration, "TSInterfaceDeclaration") ||
        isNodeOfType(declaration, "TSTypeAliasDeclaration")) &&
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.id.name === typeName
    ) {
      return declaration;
    }
  }
  return null;
};

// Property members of the styled generic's prop type: an inline type
// literal, or a reference to a same-file non-generic interface / type
// alias resolving to one. Imported, generic, and union/intersection prop
// types stay opaque (null) — their member set is not provable here.
const resolvePropTypeMembers = (
  typeNode: EsTreeNode,
  referenceNode: EsTreeNode,
  depth: number,
): ReadonlyArray<EsTreeNode> | null => {
  if (depth > TYPE_RESOLUTION_DEPTH_LIMIT) return null;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) return typeNode.members;
  if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) {
    return typeNode.typeParameters ? null : typeNode.body.body;
  }
  if (isNodeOfType(typeNode, "TSTypeAliasDeclaration")) {
    if (typeNode.typeParameters) return null;
    return resolvePropTypeMembers(typeNode.typeAnnotation, referenceNode, depth + 1);
  }
  if (
    isNodeOfType(typeNode, "TSTypeReference") &&
    isNodeOfType(typeNode.typeName, "Identifier") &&
    !typeNode.typeArguments
  ) {
    const declaration = findSameFileTypeDeclaration(referenceNode, typeNode.typeName.name);
    if (!declaration) return null;
    return resolvePropTypeMembers(declaration, referenceNode, depth + 1);
  }
  return null;
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
  if (STYLED_COMPONENTS_CONSUMED_PROPS.has(propName)) return true;
  if (!isKnownAttributeName(propName)) return false;
  const allowedTags = allowedTagsFor(propName);
  return allowedTags === null || allowedTags.has(tagName);
};

// A spread argument cannot carry the flagged prop when it is a rest binding
// from an object pattern that destructured that prop away first, e.g.
// `({ forwardedRef, ...passProps }) => <Styled {...passProps} />`.
const spreadExcludesProp = (spreadArgument: EsTreeNode, propName: string): boolean => {
  if (!isNodeOfType(spreadArgument, "Identifier")) return false;
  let currentScope: EsTreeNode | null = spreadArgument;
  while (currentScope) {
    const patterns: Array<EsTreeNode> = [];
    if (
      isNodeOfType(currentScope, "ArrowFunctionExpression") ||
      isNodeOfType(currentScope, "FunctionDeclaration") ||
      isNodeOfType(currentScope, "FunctionExpression")
    ) {
      patterns.push(...currentScope.params);
    }
    if (isNodeOfType(currentScope, "VariableDeclarator") && currentScope.id) {
      patterns.push(currentScope.id);
    }
    for (const pattern of patterns) {
      if (!isNodeOfType(pattern, "ObjectPattern")) continue;
      let bindsSpreadAsRest = false;
      let destructuresProp = false;
      for (const property of pattern.properties) {
        if (
          isNodeOfType(property, "RestElement") &&
          isNodeOfType(property.argument, "Identifier") &&
          property.argument.name === spreadArgument.name
        ) {
          bindsSpreadAsRest = true;
        }
        if (
          isNodeOfType(property, "Property") &&
          !property.computed &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === propName
        ) {
          destructuresProp = true;
        }
      }
      if (bindsSpreadAsRest) return destructuresProp;
    }
    currentScope = currentScope.parent ?? null;
  }
  return false;
};

const jsxElementName = (openingElement: EsTreeNode): string | null => {
  if (!isNodeOfType(openingElement, "JSXOpeningElement")) return null;
  return isNodeOfType(openingElement.name, "JSXIdentifier") ? openingElement.name.name : null;
};

// A module-local (never-exported) styled component whose every same-file
// JSX usage neither passes the flagged prop explicitly nor spreads an
// object that could still contain it cannot leak that prop to the DOM —
// the wrapper destructured it away (the `forwardedRef` reset-wrapper
// idiom). Exported bindings and non-JSX references stay flagged because
// outside callers can pass anything the generic permits.
const localUsagesNeverPassProp = (taggedTemplate: EsTreeNode, propName: string): boolean => {
  const declarator = taggedTemplate.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return false;
  }
  const declaration = declarator.parent;
  if (!declaration || isNodeOfType(declaration.parent, "ExportNamedDeclaration")) return false;
  const componentName = declarator.id.name;
  const programRoot = findProgramRoot(taggedTemplate);
  if (!programRoot) return false;

  let sawJsxUsage = false;
  let propCouldReachComponent = false;
  let sawEscapingReference = false;
  walkAst(programRoot, (node) => {
    if (isNodeOfType(node, "JSXOpeningElement") && jsxElementName(node) === componentName) {
      sawJsxUsage = true;
      for (const attribute of node.attributes) {
        if (
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name === propName
        ) {
          propCouldReachComponent = true;
        }
        if (
          isNodeOfType(attribute, "JSXSpreadAttribute") &&
          !spreadExcludesProp(attribute.argument, propName)
        ) {
          propCouldReachComponent = true;
        }
      }
      return false;
    }
    if (isNodeOfType(node, "Identifier") && node.name === componentName && node !== declarator.id) {
      sawEscapingReference = true;
    }
    return undefined;
  });
  return sawJsxUsage && !propCouldReachComponent && !sawEscapingReference;
};

// KNOWN ACCEPTED NOISE: an EXPORTED styled intrinsic whose generic
// declares a member that no same-file call site ever passes (dtale's
// `styled.div<StyledState>` where only `index` — not `valueNow` — is
// forwarded) still flags every non-forwardable member. Per-prop call-site
// checking cannot separate them: the export makes external callers
// invisible, and the same-file usages spread `{...props}` typed to
// include the unused member, so no single-file analysis can prove it
// never reaches the DOM. The `$`-prefix fix is still correct hygiene for
// the declared prop surface.
export const styledComponentsNonTransientCustomPropOnIntrinsicElement = defineRule({
  id: "styled-components-non-transient-custom-prop-on-intrinsic-element",
  title: "Non-transient custom prop on styled intrinsic element",
  severity: "warn",
  // v6-only: styled-components 5.1+ auto-filters unknown props via
  // @emotion/is-prop-valid, so non-transient custom props never reach the
  // DOM there — flagging v5 projects (outline, taskcafe) is a false positive.
  requires: ["styled-components:6"],
  recommendation:
    "Prefix custom styled-components props with `$` (e.g. `$active`) so styled-components v6 keeps them off the DOM node instead of forwarding them as invalid attributes.",
  create: (context) => ({
    TaggedTemplateExpression(node: EsTreeNodeOfType<"TaggedTemplateExpression">) {
      const intrinsic = readStyledIntrinsicTag(node.tag);
      if (!intrinsic) return;
      const styledImportSource = getImportSourceForName(node, "styled");
      if (styledImportSource !== null && styledImportSource !== "styled-components") return;
      const baseTag = unwrapAttrsCalls(node.tag);
      if (
        styledImportSource === null &&
        isNodeOfType(baseTag, "MemberExpression") &&
        isNodeOfType(baseTag.object, "Identifier") &&
        findVariableInitializer(baseTag.object, "styled")
      ) {
        return;
      }
      const typeArguments = node.typeArguments;
      if (!typeArguments || typeArguments.params.length === 0) return;
      const members = resolvePropTypeMembers(typeArguments.params[0], node, 0);
      if (!members) return;

      for (const member of members) {
        const propName = getPropertySignatureName(member);
        if (!propName || isForwardableToTag(propName, intrinsic.tagName)) continue;
        if (localUsagesNeverPassProp(node, propName)) continue;
        context.report({
          node: member,
          message: `styled-components v6 forwards the custom prop \`${propName}\` to the <${intrinsic.tagName}> DOM node, producing a React unknown-prop warning — prefix it with \`$\` to make it transient.`,
        });
      }
    },
  }),
});
