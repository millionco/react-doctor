import {
  DOM_PROPERTY_NAMES,
  DOM_PROPERTY_NAMES_LOWER,
} from "../../constants/dom-property-names.js";
import { DOM_PROPERTY_TO_ALLOWED_TAGS } from "../../constants/dom-property-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findSameFileTypeDeclarations } from "../../utils/find-same-file-type-declaration.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const TYPE_RESOLUTION_DEPTH_LIMIT = 3;
const jsxComponentNamesByProgram = new WeakMap<EsTreeNode, Set<string>>();

// Attributes that live in the global known-attribute set but are only
// valid on specific elements, and are NOT already scoped by
// `DOM_PROPERTY_TO_ALLOWED_TAGS`. Keeps `styled.div<{ selected }>` (a real
// leak — `selected` belongs on `<option>`) flaggable without touching the
// shared no-unknown-property tables.
const ELEMENT_RESTRICTED_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["selected", new Set(["option"])],
]);

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

const configCannotFilterProps = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const config = call.arguments[0];
  if (!config || !isNodeOfType(config, "ObjectExpression")) return false;
  return config.properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property) !== null &&
      getStaticPropertyKeyName(property) !== "shouldForwardProp",
  );
};

const unwrapStyledConfigurationCalls = (tag: EsTreeNode): EsTreeNode => {
  let current = tag;
  while (isNodeOfType(current, "CallExpression")) {
    if (
      !isNodeOfType(current.callee, "MemberExpression") ||
      current.callee.computed ||
      !isNodeOfType(current.callee.property, "Identifier")
    ) {
      break;
    }
    const configurationMethodName = current.callee.property.name;
    if (
      configurationMethodName !== "attrs" &&
      (configurationMethodName !== "withConfig" || !configCannotFilterProps(current))
    ) {
      break;
    }
    current = current.callee.object;
  }
  return current;
};

// `styled.div` / `styled.button` — a non-computed `.<lowercase>` member off
// the `styled` identifier, optionally behind `.attrs(...)` calls.
// `styled(Component)` and `withConfig(...)` produce non-matching shapes,
// so they never match here — matching the "only intrinsic, un-stripped"
// scope.
const readStyledIntrinsicTag = (
  tag: EsTreeNode,
  context: RuleContext,
): StyledIntrinsicTag | null => {
  const base = unwrapStyledConfigurationCalls(tag);
  if (!isNodeOfType(base, "MemberExpression") || base.computed) return null;
  if (!isNodeOfType(base.object, "Identifier")) return null;
  const importSource = getImportSourceForName(base, base.object.name);
  if (
    importSource !== "styled-components" &&
    !(
      importSource === null &&
      base.object.name === "styled" &&
      context.scopes.isGlobalReference(base.object)
    )
  ) {
    return null;
  }
  if (!isNodeOfType(base.property, "Identifier")) return null;
  const firstCharacterCode = base.property.name.charCodeAt(0);
  if (firstCharacterCode < 97 || firstCharacterCode > 122) return null;
  return { tagName: base.property.name };
};

// Property members of the styled generic's prop type: an inline type
// literal, or a reference to a same-file non-generic interface / type
// alias resolving to one. Imported, generic, and union prop
// types stay opaque (null) — their member set is not provable here.
const resolvePropTypeMembers = (
  typeNode: EsTreeNode,
  referenceNode: EsTreeNode,
  depth: number,
): ReadonlyArray<EsTreeNode> | null => {
  if (depth > TYPE_RESOLUTION_DEPTH_LIMIT) return null;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) return typeNode.members;
  if (isNodeOfType(typeNode, "TSIntersectionType")) {
    const memberGroups = typeNode.types.map((member) =>
      resolvePropTypeMembers(member, referenceNode, depth + 1),
    );
    if (memberGroups.some((members) => members === null)) return null;
    return memberGroups.flatMap((members) => members ?? []);
  }
  if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) {
    if (typeNode.typeParameters) return null;
    const members: EsTreeNode[] = [...typeNode.body.body];
    for (const extension of typeNode.extends ?? []) {
      if (extension.typeArguments || !isNodeOfType(extension.expression, "Identifier")) continue;
      for (const declaration of findSameFileTypeDeclarations(
        referenceNode,
        extension.expression.name,
      )) {
        const inheritedMembers = resolvePropTypeMembers(declaration, referenceNode, depth + 1);
        if (inheritedMembers) members.push(...inheritedMembers);
      }
    }
    return members;
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
    const declarations = findSameFileTypeDeclarations(referenceNode, typeNode.typeName.name);
    if (declarations.length === 0) return null;
    const memberGroups = declarations.map((declaration) =>
      resolvePropTypeMembers(declaration, referenceNode, depth + 1),
    );
    if (memberGroups.some((members) => members === null)) return null;
    return memberGroups.flatMap((members) => members ?? []);
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
  if (STYLED_COMPONENTS_CONSUMED_PROPS.has(propName)) return true;
  if (!isKnownAttributeName(propName)) return false;
  const allowedTags = allowedTagsFor(propName);
  return allowedTags === null || allowedTags.has(tagName);
};

// A spread argument cannot carry the flagged prop when it is a rest binding
// from an object pattern that destructured that prop away first, e.g.
// `({ forwardedRef, ...passProps }) => <Styled {...passProps} />`.
const spreadExcludesProp = (
  spreadArgument: EsTreeNode,
  propName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(spreadArgument, "Identifier")) return false;
  const spreadSymbol = context.scopes.symbolFor(spreadArgument);
  if (!spreadSymbol) return false;
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
          context.scopes.symbolFor(property.argument)?.id === spreadSymbol.id
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

// A module-local (never-exported) styled component whose every same-file
// JSX usage neither passes the flagged prop explicitly nor spreads an
// object that could still contain it cannot leak that prop to the DOM —
// the wrapper destructured it away (the `forwardedRef` reset-wrapper
// idiom). Exported bindings and non-JSX references stay flagged because
// outside callers can pass anything the generic permits.
const localUsagesNeverPassProp = (
  taggedTemplate: EsTreeNode,
  propName: string,
  context: RuleContext,
): boolean => {
  const declarator = taggedTemplate.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return false;
  }
  const declaration = declarator.parent;
  if (!declaration || isNodeOfType(declaration.parent, "ExportNamedDeclaration")) return false;
  const componentSymbol = context.scopes.symbolFor(declarator.id);
  if (!componentSymbol) return false;
  if (componentSymbol.references.length === 0) {
    const programRoot = findProgramRoot(taggedTemplate);
    if (!programRoot) return false;
    let jsxComponentNames = jsxComponentNamesByProgram.get(programRoot);
    if (!jsxComponentNames) {
      jsxComponentNames = new Set<string>();
      jsxComponentNamesByProgram.set(programRoot, jsxComponentNames);
      walkAst(programRoot, (candidate) => {
        if (
          isNodeOfType(candidate, "JSXOpeningElement") &&
          isNodeOfType(candidate.name, "JSXIdentifier")
        ) {
          jsxComponentNames?.add(candidate.name.name);
        }
      });
    }
    return jsxComponentNames.has(declarator.id.name);
  }

  let sawJsxUsage = false;
  let propCouldReachComponent = false;
  let sawEscapingReference = false;
  for (const reference of componentSymbol.references) {
    const node = reference.identifier.parent;
    if (node && isNodeOfType(node, "JSXOpeningElement") && node.name === reference.identifier) {
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
          !spreadExcludesProp(attribute.argument, propName, context)
        ) {
          propCouldReachComponent = true;
        }
      }
      continue;
    }
    sawEscapingReference = true;
  }
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
      const intrinsic = readStyledIntrinsicTag(node.tag, context);
      if (!intrinsic) return;
      const typeArguments = node.typeArguments;
      if (!typeArguments || typeArguments.params.length === 0) return;
      const members = resolvePropTypeMembers(typeArguments.params[0], node, 0);
      if (!members) return;

      for (const member of members) {
        const propName = getPropertySignatureName(member);
        if (!propName || isForwardableToTag(propName, intrinsic.tagName)) continue;
        if (localUsagesNeverPassProp(node, propName, context)) continue;
        context.report({
          node: member,
          message: `styled-components v6 forwards the custom prop \`${propName}\` to the <${intrinsic.tagName}> DOM node, producing a React unknown-prop warning — prefix it with \`$\` to make it transient.`,
        });
      }
    },
  }),
});
