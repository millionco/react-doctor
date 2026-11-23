import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getImportedName } from "./get-imported-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenStyledComponentExpression } from "./is-proven-styled-component-expression.js";
import { walkAst } from "./walk-ast.js";

interface ThemeUse {
  readonly module: SourceProjectModule;
  readonly node: EsTreeNodeOfType<"JSXOpeningElement">;
}

const HEX_COLOR = /^(?:#[a-f0-9]{3}|#[a-f0-9]{6})$/i;
const PLAIN_CSS_SCALAR = /^[\w\t .,%"'#-]*$/;

const readOwnLiteralTheme = (
  themeModule: SourceProjectModule,
): ReadonlyMap<string, string> | null => {
  const [declaration] = themeModule.programNode.body;
  if (
    themeModule.programNode.body.length !== 1 ||
    !isNodeOfType(declaration, "ExportDefaultDeclaration") ||
    !isNodeOfType(declaration.declaration, "ObjectExpression")
  ) {
    return null;
  }
  const propertyNames = new Set<string>();
  const colors = new Map<string, string>();
  for (const property of declaration.declaration.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method ||
      property.shorthand
    ) {
      return null;
    }
    const name = getStaticKeyName(property.key);
    if (!name || name === "__proto__" || propertyNames.has(name)) return null;
    propertyNames.add(name);
    const scalar = property.value;
    const value = isNodeOfType(scalar, "Literal")
      ? scalar.value
      : isNodeOfType(scalar, "TemplateLiteral") && scalar.expressions.length === 0
        ? scalar.quasis[0]?.value.cooked
        : null;
    if (typeof value === "number" && Number.isFinite(value)) continue;
    if (typeof value !== "string" || !PLAIN_CSS_SCALAR.test(value)) return null;
    if (HEX_COLOR.test(value)) colors.set(name, value);
  }
  return colors.size ? colors : null;
};

const collectSingleThemeProvider = (project: SourceProjectIndex): ThemeUse | null => {
  let provider: ThemeUse | null = null;
  for (const module of project.modulesByFilePath.values()) {
    for (const statement of module.programNode.body) {
      if (
        !isNodeOfType(statement, "ImportDeclaration") ||
        statement.source.value !== "styled-components"
      )
        continue;
      for (const specifier of statement.specifiers) {
        if (isNodeOfType(specifier, "ImportDefaultSpecifier")) continue;
        if (!isNodeOfType(specifier, "ImportSpecifier")) return null;
        const imported = getImportedName(specifier);
        if (imported === "css" || imported === "styled") continue;
        if (imported !== "ThemeProvider" || provider) return null;
        const binding = module.scopes.symbolFor(specifier.local);
        if (!binding || !hasCompleteSymbolReferences(binding, module.programNode, module.scopes))
          return null;
        let opening: ThemeUse["node"] | null = null;
        let closingCount = 0;
        for (const reference of binding.references) {
          const identifier = reference.identifier;
          const parent = identifier.parent;
          if (reference.flag !== "read" || !isNodeOfType(identifier, "JSXIdentifier")) return null;
          if (isNodeOfType(parent, "JSXClosingElement") && parent.name === identifier) {
            closingCount += 1;
          } else if (
            isNodeOfType(parent, "JSXOpeningElement") &&
            parent.name === identifier &&
            !opening
          ) {
            opening = parent;
          } else {
            return null;
          }
        }
        if (!opening || closingCount !== 1) return null;
        provider = { module, node: opening };
      }
    }
  }
  return provider;
};

const readSourceThemeReference = (
  provider: ThemeUse,
  project: SourceProjectIndex,
): SourceProjectModule | null => {
  const { node, module } = provider;
  const [attribute] = node.attributes;
  if (
    node.attributes.length !== 1 ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "theme" ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(attribute.value.expression, "Identifier")
  )
    return null;
  const identifier = attribute.value.expression;
  const binding = module.scopes.symbolFor(identifier);
  if (
    !binding ||
    !isNodeOfType(binding.declarationNode, "ImportDefaultSpecifier") ||
    !hasCompleteSymbolReferences(binding, module.programNode, module.scopes) ||
    binding.references.length !== 1 ||
    binding.references[0]?.identifier !== identifier ||
    binding.references[0]?.flag !== "read"
  )
    return null;
  const declaration = binding.declarationNode.parent;
  if (
    !isNodeOfType(declaration, "ImportDeclaration") ||
    typeof declaration.source.value !== "string" ||
    !/^\.\.?\//.test(declaration.source.value)
  )
    return null;
  const themePath = project.resolvedSourcePathByNode.get(declaration);
  if (!themePath) return null;
  const consumers = project.consumerModulesByFilePath.get(themePath);
  if (!consumers || consumers.size !== 1 || !consumers.has(module)) return null;
  return project.modulesByFilePath.get(themePath) ?? null;
};

const hasOnlyOrdinaryThemeReads = (
  module: SourceProjectModule,
  provider: ThemeUse,
  currentFilePath: string,
): boolean => {
  const { scopes } = module;
  let unsafe = false;
  walkAst(module.programNode, (node: EsTreeNode) => {
    if (unsafe) return false;
    if (isNodeOfType(node, "JSXOpeningElement") && node !== provider.node) {
      unsafe = node.attributes.some(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name === "theme",
      );
      if (
        !unsafe &&
        module.filePath === currentFilePath &&
        isNodeOfType(node.name, "JSXIdentifier")
      ) {
        const binding = scopes.symbolFor(node.name);
        const initializer = binding ? getDirectConstInitializer(binding) : null;
        unsafe = Boolean(
          initializer &&
          isProvenStyledComponentExpression(initializer, scopes) &&
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")),
        );
      }
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      getResolvedStaticPropertyName(node, scopes) === "theme"
    ) {
      const member = node.parent;
      const callback = findEnclosingFunction(node);
      const containingTemplate = member?.parent;
      const [parameter] = isNodeOfType(callback, "ArrowFunctionExpression") ? callback.params : [];
      if (
        node.computed ||
        node.optional ||
        !isNodeOfType(node.object, "Identifier") ||
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== node ||
        member.computed ||
        member.optional ||
        !isNodeOfType(member.property, "Identifier") ||
        !isNodeOfType(callback, "ArrowFunctionExpression") ||
        (callback.body !== member &&
          (!isNodeOfType(containingTemplate, "TemplateLiteral") ||
            !containingTemplate.expressions.some((expression) => Object.is(expression, member)))) ||
        !isNodeOfType(parameter, "Identifier") ||
        scopes.symbolFor(node.object) !== scopes.symbolFor(parameter) ||
        !scopes.symbolFor(parameter)
      )
        unsafe = true;
    }
    return !unsafe;
  });
  return !unsafe;
};

export const readLocalStyledThemeProof = (
  project: SourceProjectIndex,
  currentFilePath: string,
): { colors: ReadonlyMap<string, string>; provider: ThemeUse } | null => {
  if (project.hasOpaqueMdxConsumerSurface) return null;
  const provider = collectSingleThemeProvider(project);
  if (!provider) return null;
  const themeModule = readSourceThemeReference(provider, project);
  if (!themeModule) return null;
  for (const module of project.modulesByFilePath.values()) {
    if (!hasOnlyOrdinaryThemeReads(module, provider, currentFilePath)) return null;
  }
  const colors = readOwnLiteralTheme(themeModule);
  return colors ? { colors, provider } : null;
};
