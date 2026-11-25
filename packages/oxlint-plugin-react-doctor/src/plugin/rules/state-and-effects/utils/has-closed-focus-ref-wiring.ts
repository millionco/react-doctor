import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenStyledComponentExpression } from "../../../utils/is-proven-styled-component-expression.js";
import {
  resolveCrossFileExport,
  type ResolvedCrossFileExport,
} from "../../../utils/resolve-cross-file-export.js";
import { resolveRelativeImportPath } from "../../../utils/resolve-relative-import-path.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";

const isStyledInputMember = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  getStaticPropertyName(node) === "input" &&
  isDirectStyledFactory(node.object, scopes);

const isDirectStyledFactory = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  return declaration?.source.value === "styled-components";
};

const hasStableStyledBinding = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  symbol.references.every(({ identifier, flag }) => {
    if (flag !== "read") return false;
    const parent = identifier.parent;
    if (!parent) return false;
    if (
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === identifier
    ) {
      return true;
    }
    if (isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === identifier) {
      return true;
    }
    if (isNodeOfType(parent, "ExportSpecifier") && parent.local === identifier) return true;
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments.length === 1 &&
      parent.arguments[0] === identifier &&
      isDirectStyledFactory(parent.callee, scopes) &&
      isNodeOfType(parent.parent, "TaggedTemplateExpression") &&
      parent.parent.tag === parent
    ) {
      return true;
    }
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.computed ||
      parent.object !== identifier
    ) {
      return false;
    }
    const member = getStaticPropertyName(parent);
    const assignment = parent.parent;
    return (
      (member === "displayName" || member === "propTypes") &&
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === parent
    );
  });

// Accept only a stock input with attrs that add presentation data and
// pass the remaining props through unchanged. In particular, neither wrapper
// may synthesize a focus handler or substitute the element being focused.
const isStyledInputLeaf = (candidate: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(candidate, "TaggedTemplateExpression") ||
    !isProvenStyledComponentExpression(candidate, scopes)
  ) {
    return false;
  }
  const declaration = candidate.parent;
  if (isNodeOfType(declaration, "VariableDeclarator") && declaration.init === candidate) {
    const binding = scopes.symbolFor(declaration.id);
    if (binding?.kind !== "const" || !hasStableStyledBinding(binding, scopes)) return false;
  } else if (!isNodeOfType(declaration, "ExportDefaultDeclaration")) {
    return false;
  }
  const tag = candidate.tag;
  if (isStyledInputMember(tag, scopes)) return true;
  if (
    !isNodeOfType(tag, "CallExpression") ||
    tag.optional ||
    tag.arguments.length !== 1 ||
    !isNodeOfType(tag.callee, "MemberExpression") ||
    tag.callee.computed ||
    tag.callee.optional ||
    getStaticPropertyName(tag.callee) !== "attrs" ||
    !isStyledInputMember(tag.callee.object, scopes)
  ) {
    return false;
  }
  const [attrs] = tag.arguments;
  if (
    !isNodeOfType(attrs, "ArrowFunctionExpression") ||
    attrs.async ||
    attrs.params.length !== 1 ||
    !isNodeOfType(attrs.params[0], "ObjectPattern") ||
    attrs.params[0].properties.length !== 2
  ) {
    return false;
  }
  const attrsValue = stripParenExpression(attrs.body);
  if (!isNodeOfType(attrsValue, "ObjectExpression") || attrsValue.properties.length !== 3) {
    return false;
  }
  const [themeProp, rest] = attrs.params[0].properties;
  if (
    !isNodeOfType(themeProp, "Property") ||
    themeProp.computed ||
    getStaticPropertyKeyName(themeProp) !== "theme" ||
    !isNodeOfType(themeProp.value, "Identifier") ||
    !isNodeOfType(rest, "RestElement") ||
    !isNodeOfType(rest.argument, "Identifier")
  ) {
    return false;
  }
  const [theme, skin, passthrough] = attrsValue.properties;
  if (
    !isNodeOfType(theme, "Property") ||
    theme.computed ||
    theme.kind !== "init" ||
    getStaticPropertyKeyName(theme) !== "theme" ||
    !isNodeOfType(theme.value, "ObjectExpression") ||
    !isNodeOfType(skin, "Property") ||
    skin.computed ||
    skin.kind !== "init" ||
    getStaticPropertyKeyName(skin) !== "skin" ||
    !isNodeOfType(skin.value, "Literal") ||
    typeof skin.value.value !== "string" ||
    !isNodeOfType(passthrough, "SpreadElement") ||
    !isNodeOfType(passthrough.argument, "Identifier")
  ) {
    return false;
  }
  const restSymbol = scopes.symbolFor(rest.argument);
  const themeSymbol = scopes.symbolFor(themeProp.value);
  return Boolean(
    restSymbol &&
    themeSymbol &&
    scopes.symbolFor(passthrough.argument) === restSymbol &&
    theme.value.properties.every((entry) =>
      isNodeOfType(entry, "SpreadElement")
        ? scopes.symbolFor(entry.argument) === themeSymbol
        : isNodeOfType(entry, "Property") &&
          !entry.computed &&
          entry.kind === "init" &&
          isNodeOfType(entry.value, "Identifier"),
    ),
  );
};

const isRelativeSpecifier = (value: unknown): value is string =>
  typeof value === "string" && (value.startsWith("./") || value.startsWith("../"));

const resolveDirectStyledInputExport = (
  filename: string,
  source: string,
  exportedName: string,
): ResolvedCrossFileExport | null => {
  if (!isRelativeSpecifier(source)) return null;
  const selectedPath = resolveRelativeImportPath(filename, source);
  if (!selectedPath) return null;
  const resolved = resolveCrossFileExport(filename, source, exportedName);
  if (
    !resolved ||
    resolved.filePath !== selectedPath ||
    !isNodeOfType(resolved.programNode, "Program") ||
    resolved.programNode.body.some(
      (entry) => isNodeOfType(entry, "ImportDeclaration") && entry.specifiers.length === 0,
    )
  ) {
    return null;
  }
  return resolved;
};

export const resolveStyledInputLeaf = (
  filename: string,
  source: string,
  exportedName: string,
): ResolvedCrossFileExport | null => {
  const direct = resolveDirectStyledInputExport(filename, source, exportedName);
  if (!direct || !isNodeOfType(direct.node, "Identifier")) return direct;
  // A barrel may import a binding and re-export it in a separate
  // statement. Follow one relative import from an import/export-only module.
  const barrel = direct.programNode;
  if (!isNodeOfType(barrel, "Program")) return null;
  let localName: string | null = null;
  for (const entry of barrel.body) {
    if (isNodeOfType(entry, "ImportDeclaration")) continue;
    if (
      !isNodeOfType(entry, "ExportNamedDeclaration") ||
      entry.source ||
      entry.declaration ||
      entry.exportKind === "type"
    ) {
      return null;
    }
    for (const specifier of entry.specifiers) {
      if (
        !isNodeOfType(specifier, "ExportSpecifier") ||
        specifier.exportKind === "type" ||
        !isNodeOfType(specifier.exported, "Identifier") ||
        specifier.exported.name !== exportedName
      ) {
        continue;
      }
      if (localName || !isNodeOfType(specifier.local, "Identifier")) return null;
      localName = specifier.local.name;
    }
  }
  const binding = localName && getImportBindingForName(barrel, localName);
  if (!binding || binding.isNamespace || !binding.exportedName) return null;
  return resolveDirectStyledInputExport(direct.filePath, binding.source, binding.exportedName);
};

const isLocalStyledInputComponent = (tag: EsTreeNode, context: RuleContext): boolean => {
  const symbol = context.scopes.symbolFor(tag);
  const initializer = symbol?.initializer;
  if (symbol?.kind !== "const" || !initializer || !hasStableStyledBinding(symbol, context.scopes)) {
    return false;
  }
  if (isStyledInputLeaf(initializer, context.scopes)) return true;
  if (
    !context.filename ||
    !isNodeOfType(initializer, "TaggedTemplateExpression") ||
    !isNodeOfType(initializer.tag, "CallExpression") ||
    initializer.tag.optional ||
    !isDirectStyledFactory(initializer.tag.callee, context.scopes) ||
    initializer.tag.arguments.length !== 1 ||
    !isNodeOfType(initializer.tag.arguments[0], "Identifier")
  ) {
    return false;
  }
  const wrapped = context.scopes.symbolFor(initializer.tag.arguments[0]);
  if (!wrapped || !hasStableStyledBinding(wrapped, context.scopes)) return false;
  if (wrapped.kind === "const" && wrapped.initializer) {
    return isStyledInputLeaf(wrapped.initializer, context.scopes);
  }
  const declaration = getImportDeclarationForSymbol(wrapped);
  const source = declaration?.source.value;
  const exportedName = isNodeOfType(wrapped.declarationNode, "ImportDefaultSpecifier")
    ? "default"
    : getImportedName(wrapped.declarationNode);
  if (!isRelativeSpecifier(source) || !exportedName) return false;
  const resolved = resolveStyledInputLeaf(context.filename, source, exportedName);
  return Boolean(resolved && isStyledInputLeaf(resolved.node, analyzeScopes(resolved.programNode)));
};

const FOCUS_PROP_PATTERN = /^on(?:Focus|Blur)(?:In|Out)?(?:Capture)?$/i;

export const hasClosedFocusRefWiring = (
  ref: SymbolDescriptor,
  acquisition: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  let attachments = 0;
  for (const { identifier, flag } of ref.references) {
    if (flag !== "read") return false;
    const parent = identifier.parent;
    if (parent === acquisition) continue;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === identifier &&
      !parent.computed &&
      getStaticPropertyName(parent) === "current"
    ) {
      const comparison = parent.parent;
      if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "===") {
        return false;
      }
      const other = comparison.left === parent ? comparison.right : comparison.left;
      if (
        !isNodeOfType(other, "MemberExpression") ||
        getStaticPropertyName(other) !== "activeElement" ||
        !isNodeOfType(other.object, "Identifier") ||
        other.object.name !== "document" ||
        context.scopes.symbolFor(other.object)
      ) {
        return false;
      }
      continue;
    }
    const attribute = parent?.parent;
    const opening = attribute?.parent;
    if (
      !isNodeOfType(parent, "JSXExpressionContainer") ||
      parent.expression !== identifier ||
      !isNodeOfType(attribute, "JSXAttribute") ||
      getJsxAttributeName(attribute.name) !== "ref" ||
      !isNodeOfType(opening, "JSXOpeningElement") ||
      !isNodeOfType(opening.name, "JSXIdentifier") ||
      findEnclosingFunction(opening) !== component ||
      opening.attributes.some(
        (entry) =>
          isNodeOfType(entry, "JSXAttribute") &&
          (getJsxAttributeName(entry.name) === "as" ||
            getJsxAttributeName(entry.name) === "forwardedAs" ||
            getJsxAttributeName(entry.name) === "is"),
      )
    ) {
      return false;
    }
    if (opening.name.name !== "input" && !isLocalStyledInputComponent(opening.name, context)) {
      return false;
    }
    attachments += 1;
  }
  if (attachments !== 1) return false;

  // The active option can blur while the input is focused. Preserve visible
  // handlers throughout this component, including JSX produced by local helpers.
  let containsFocusObserver = false;
  walkAst(component, (child) => {
    if (containsFocusObserver) return false;
    if (
      isNodeOfType(child, "JSXSpreadAttribute") ||
      (isNodeOfType(child, "JSXAttribute") &&
        FOCUS_PROP_PATTERN.test(getJsxAttributeName(child.name) ?? ""))
    ) {
      containsFocusObserver = true;
      return false;
    }
  });
  return !containsFocusObserver;
};
