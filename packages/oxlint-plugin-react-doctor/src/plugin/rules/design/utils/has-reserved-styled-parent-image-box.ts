import { STYLED_SCREEN_BOX_MAX_MEDIA_QUERY_COUNT } from "../../../constants/design.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyMutationOrEscapeBefore } from "../../../utils/has-static-property-write-before.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenStyledComponentExpression } from "../../../utils/is-proven-styled-component-expression.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasReservedStyledScreenBox } from "./has-reserved-styled-screen-box.js";
import type { StyledScreenBoxFragment } from "./has-reserved-styled-screen-box.js";

interface StyledMediaBounds {
  readonly minWidthPx: number;
  readonly maxWidthPx: number;
}

interface StyledMediaProvider {
  readonly declaration: EsTreeNodeOfType<"ObjectExpression">;
  readonly scopes: ScopeAnalysis;
}

const isRuntimeCssImport = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = scopes.symbolFor(identifier);
  const declaration = symbol?.declarationNode;
  const parent = declaration?.parent;
  return Boolean(
    symbol?.kind === "import" &&
    declaration &&
    getImportedName(declaration) === "css" &&
    isNodeOfType(declaration, "ImportSpecifier") &&
    declaration.importKind !== "type" &&
    isNodeOfType(parent, "ImportDeclaration") &&
    parent.importKind !== "type" &&
    parent.source.value === "styled-components" &&
    symbol.references.every((reference) => reference.flag === "read"),
  );
};

const getTemplateText = (template: EsTreeNodeOfType<"TemplateLiteral">): string | null => {
  if (template.expressions.length !== 0) return null;
  const quasi = template.quasis[0];
  return quasi && quasi.value.cooked === quasi.value.raw ? quasi.value.raw : null;
};

const resolveMediaProvider = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): StyledMediaProvider | null => {
  const symbol = context.scopes.symbolFor(identifier);
  const declaration = symbol?.declarationNode;
  const importDeclaration = declaration?.parent;
  if (
    !context.filename ||
    !symbol ||
    !isNodeOfType(declaration, "ImportDefaultSpecifier") ||
    !isNodeOfType(importDeclaration, "ImportDeclaration") ||
    importDeclaration.importKind === "type" ||
    typeof importDeclaration.source.value !== "string" ||
    !importDeclaration.source.value.startsWith(".")
  )
    return null;
  const resolved = resolveCrossFileValueExportWithFilePath(
    context.filename,
    importDeclaration.source.value,
    "default",
  );
  if (
    !resolved ||
    resolved.filePath !== resolveModulePath(context.filename, importDeclaration.source.value) ||
    !isNodeOfType(resolved.exportedNode, "ObjectExpression") ||
    !isNodeOfType(resolved.programNode, "Program") ||
    !resolved.programNode.body.every(
      (statement) =>
        isNodeOfType(statement, "ImportDeclaration") ||
        (isNodeOfType(statement, "ExportDefaultDeclaration") &&
          statement.declaration === resolved.exportedNode),
    )
  )
    return null;
  const providerImports = resolved.programNode.body.filter((statement) =>
    isNodeOfType(statement, "ImportDeclaration"),
  );
  if (providerImports.length !== 1 || providerImports[0]?.source.value !== "styled-components")
    return null;
  return { declaration: resolved.exportedNode, scopes: analyzeScopes(resolved.programNode) };
};

const getMediaBounds = (
  expression: EsTreeNodeOfType<"TaggedTemplateExpression">,
  context: RuleContext,
  parentTemplate: EsTreeNode,
): StyledMediaBounds | null => {
  const tag = stripParenExpression(expression.tag);
  if (
    !isNodeOfType(tag, "MemberExpression") ||
    tag.computed ||
    tag.optional ||
    !isNodeOfType(tag.object, "Identifier")
  )
    return null;
  const propertyName = getStaticPropertyName(tag);
  if (
    !propertyName ||
    hasPossibleStaticPropertyMutationOrEscapeBefore(
      tag.object,
      propertyName,
      parentTemplate,
      context.scopes,
    )
  )
    return null;
  const provider = resolveMediaProvider(tag.object, context);
  if (!provider) return null;
  const properties = provider.declaration.properties;
  if (properties.length > STYLED_SCREEN_BOX_MAX_MEDIA_QUERY_COUNT) return null;
  if (
    !properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        !property.method &&
        property.kind === "init",
    )
  )
    return null;
  const matches = properties.filter(
    (property) =>
      isNodeOfType(property, "Property") && getStaticKeyName(property.key) === propertyName,
  );
  const property = matches.length === 1 ? matches[0] : null;
  if (!isNodeOfType(property, "Property")) return null;
  if (
    !properties.every(
      (candidate) =>
        isNodeOfType(candidate, "Property") &&
        getMediaWrapperBounds(candidate.value, provider.scopes) !== null,
    )
  )
    return null;
  return getMediaWrapperBounds(property.value, provider.scopes);
};

const getMediaWrapperBounds = (
  value: EsTreeNode,
  scopes: ScopeAnalysis,
): StyledMediaBounds | null => {
  const callback = stripParenExpression(value);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1
  )
    return null;
  const parameter = callback.params[0];
  if (!isNodeOfType(parameter, "RestElement") || !isNodeOfType(parameter.argument, "Identifier"))
    return null;
  const body = stripParenExpression(callback.body);
  if (
    !isNodeOfType(body, "TaggedTemplateExpression") ||
    !isRuntimeCssImport(body.tag, scopes) ||
    body.quasi.expressions.length !== 1
  )
    return null;
  const interpolation = body.quasi.expressions[0];
  if (
    !isNodeOfType(interpolation, "CallExpression") ||
    interpolation.optional ||
    !isRuntimeCssImport(interpolation.callee, scopes) ||
    interpolation.arguments.length !== 1
  )
    return null;
  const argument = interpolation.arguments[0];
  if (
    !isNodeOfType(argument, "SpreadElement") ||
    !isNodeOfType(argument.argument, "Identifier") ||
    scopes.symbolFor(argument.argument) !== scopes.symbolFor(parameter.argument)
  )
    return null;
  const [prefix, suffix] = body.quasi.quasis;
  if (
    !prefix ||
    !suffix ||
    prefix.value.cooked !== prefix.value.raw ||
    suffix.value.cooked !== suffix.value.raw
  )
    return null;
  const text = `${prefix.value.raw}__BODY__${suffix.value.raw}`;
  if (/[^\t\n\f\r\x20-\x7e]/.test(text)) return null;
  const match =
    /^\s*@media\s+(?:screen\s+and\s+)?\(\s*(min|max)-width\s*:\s*((?:\d*\.)?\d+)px\s*\)\s*\{\s*__BODY__\s*\}\s*$/i.exec(
      text,
    );
  if (!match?.[1] || !match[2]) return null;
  const widthPx = Number(match[2]);
  if (!Number.isFinite(widthPx) || widthPx < 0) return null;
  return {
    minWidthPx: match[1].toLowerCase() === "min" ? widthPx : 0,
    maxWidthPx: match[1].toLowerCase() === "max" ? widthPx : Infinity,
  };
};

const hasOnlyJsxTagReferences = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(({ identifier, flag }) => {
    const parent = identifier.parent;
    return (
      flag === "read" &&
      isNodeOfType(identifier, "JSXIdentifier") &&
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === identifier
    );
  });

const hasOnlyNonSizingNestedBorders = (source: string): boolean => {
  if (source.includes("@")) return false;
  let isSupported = true;
  const remainder = source.replace(/\{([^{}]*)\}/g, (_match, body: string) => {
    const declarations = body.trim().split(";");
    if (declarations.pop()?.trim()) isSupported = false;
    for (const declaration of declarations) {
      if (
        !/^\s*border(?:-(?:top|right|bottom|left|color|style|width))?\s*:\s*[^;{}:!/\\]+\s*$/i.test(
          declaration,
        )
      )
        isSupported = false;
    }
    return "";
  });
  return isSupported && !/[{}]/.test(remainder);
};

const isThemeColorInterpolation = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(expression, "ArrowFunctionExpression") ||
    expression.async ||
    expression.params.length !== 1 ||
    !isNodeOfType(expression.params[0], "Identifier")
  )
    return false;
  const body = expression.body;
  if (
    !isNodeOfType(body, "MemberExpression") ||
    body.computed ||
    body.optional ||
    !isNodeOfType(body.object, "MemberExpression") ||
    body.object.computed ||
    body.object.optional ||
    getStaticPropertyName(body.object) !== "theme" ||
    !isNodeOfType(body.object.object, "Identifier")
  )
    return false;
  return scopes.symbolFor(body.object.object) === scopes.symbolFor(expression.params[0]);
};

export const hasReservedStyledParentImageBox = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (
    node.attributes.some(
      (attribute) =>
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        !["src", "alt", "loading", "decoding"].includes(attribute.name.name),
    )
  )
    return false;
  const image = node.parent;
  const parent = image?.parent;
  if (
    !isNodeOfType(image, "JSXElement") ||
    !isNodeOfType(parent, "JSXElement") ||
    parent.openingElement.attributes.length !== 0 ||
    !isNodeOfType(parent.openingElement.name, "JSXIdentifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(parent.openingElement.name);
  if (
    !symbol ||
    symbol.scope.kind !== "module" ||
    !hasOnlyJsxTagReferences(symbol) ||
    symbol.references.some(
      (reference) => reference.identifier.range[0] < symbol.declarationNode.range[1],
    ) ||
    !isNodeOfType(symbol.declarationNode.parent?.parent, "Program")
  )
    return false;
  const initializer = getDirectConstInitializer(symbol);
  if (
    !initializer ||
    !isNodeOfType(initializer, "TaggedTemplateExpression") ||
    !isProvenStyledComponentExpression(initializer, context.scopes)
  )
    return false;
  if (initializer.quasi.expressions.length > STYLED_SCREEN_BOX_MAX_MEDIA_QUERY_COUNT) return false;
  let hasCompetingStyles = false;
  const ancestorTemplates = new Set<EsTreeNode>();
  for (let ancestor = parent.parent; ancestor; ancestor = ancestor.parent) {
    if (!isNodeOfType(ancestor, "JSXElement")) continue;
    if (ancestor.openingElement.attributes.length !== 0) return false;
    const ancestorName = ancestor.openingElement.name;
    if (!isNodeOfType(ancestorName, "JSXIdentifier")) return false;
    if (/^[a-z]/.test(ancestorName.name)) continue;
    const ancestorSymbol = context.scopes.symbolFor(ancestorName);
    const ancestorInitializer = ancestorSymbol ? getDirectConstInitializer(ancestorSymbol) : null;
    if (
      !ancestorInitializer ||
      !isNodeOfType(ancestorInitializer, "TaggedTemplateExpression") ||
      !isProvenStyledComponentExpression(ancestorInitializer, context.scopes)
    )
      return false;
    ancestorTemplates.add(ancestorInitializer);
    const ancestorFactory = ancestorInitializer.tag;
    if (
      !ancestorSymbol ||
      !hasOnlyJsxTagReferences(ancestorSymbol) ||
      !isNodeOfType(ancestorFactory, "MemberExpression") ||
      ancestorFactory.computed ||
      !isNodeOfType(ancestorFactory.property, "Identifier") ||
      !/^[a-z]/.test(ancestorFactory.property.name)
    )
      return false;
    walkAst(ancestorInitializer, (candidate) => {
      if (isNodeOfType(candidate, "TemplateLiteral")) {
        let depth = 0;
        for (let index = 0; index < candidate.quasis.length; index += 1) {
          const quasi = candidate.quasis[index];
          if (!quasi || quasi.value.cooked !== quasi.value.raw) {
            hasCompetingStyles = true;
            break;
          }
          for (const character of quasi.value.raw) {
            if (character === "{") depth += 1;
            if (character === "}") depth -= 1;
          }
          const expression = candidate.expressions[index];
          if (!expression) continue;
          if (depth !== 0) {
            hasCompetingStyles = true;
            break;
          }
          if (
            isNodeOfType(expression, "TaggedTemplateExpression") &&
            getMediaBounds(expression, context, ancestorInitializer)
          )
            continue;
          if (
            !/(?:^|[;{}])\s*border(?:-[a-z]+)?\s*:[^;{}]*$/.test(quasi.value.raw) ||
            !isThemeColorInterpolation(expression, context.scopes)
          ) {
            hasCompetingStyles = true;
            break;
          }
        }
      }
      if (
        isNodeOfType(candidate, "TemplateLiteral") &&
        candidate.quasis.some((quasi) => !hasOnlyNonSizingNestedBorders(quasi.value.raw))
      )
        hasCompetingStyles = true;
      return !hasCompetingStyles;
    });
  }
  walkAst(context.scopes.rootScope.node, (candidate) => {
    if (candidate === initializer) return false;
    if (
      isNodeOfType(candidate, "JSXAttribute") &&
      isNodeOfType(candidate.name, "JSXIdentifier") &&
      candidate.name.name === "dangerouslySetInnerHTML"
    )
      hasCompetingStyles = true;
    if (isNodeOfType(candidate, "NewExpression")) hasCompetingStyles = true;
    if (isNodeOfType(candidate, "CallExpression")) {
      const owner = candidate.parent;
      if (
        !isNodeOfType(owner, "TaggedTemplateExpression") ||
        owner.tag !== candidate ||
        !isNodeOfType(candidate.callee, "Identifier") ||
        !isProvenStyledComponentExpression(owner, context.scopes)
      )
        hasCompetingStyles = true;
    }
    if (
      isNodeOfType(candidate, "TaggedTemplateExpression") &&
      isProvenStyledComponentExpression(candidate, context.scopes) &&
      !ancestorTemplates.has(candidate) &&
      (candidate.quasi.expressions.length !== 0 ||
        candidate.quasi.quasis.some(
          (quasi) =>
            quasi.value.cooked !== quasi.value.raw ||
            !hasOnlyNonSizingNestedBorders(quasi.value.raw),
        ))
    )
      hasCompetingStyles = true;
    if (
      isNodeOfType(candidate, "TaggedTemplateExpression") &&
      !isProvenStyledComponentExpression(candidate, context.scopes) &&
      !getMediaBounds(candidate, context, candidate)
    )
      hasCompetingStyles = true;

    if (
      isNodeOfType(candidate, "Identifier") &&
      ["document", "window", "globalThis", "require", "eval", "Function"].includes(candidate.name)
    )
      hasCompetingStyles = true;
    if (isNodeOfType(candidate, "ImportExpression")) hasCompetingStyles = true;
    if (isNodeOfType(candidate, "ImportDeclaration")) {
      hasCompetingStyles ||=
        typeof candidate.source.value === "string" &&
        /\.(?:css|scss|sass|less|styl)(?:[?#].*)?$/i.test(candidate.source.value);
      hasCompetingStyles ||= candidate.specifiers.some(
        (specifier) => getImportedName(specifier) === "createGlobalStyle",
      );
    }
    if (
      isNodeOfType(candidate, "JSXOpeningElement") &&
      isNodeOfType(candidate.name, "JSXIdentifier") &&
      ["style", "link"].includes(candidate.name.name)
    )
      hasCompetingStyles = true;
    return !hasCompetingStyles;
  });
  if (hasCompetingStyles) return false;
  const factory = stripParenExpression(initializer.tag);
  if (
    !isNodeOfType(factory, "MemberExpression") ||
    factory.computed ||
    factory.optional ||
    !isNodeOfType(factory.object, "Identifier") ||
    getStaticPropertyName(factory) !== "div" ||
    hasPossibleStaticPropertyMutationOrEscapeBefore(
      factory.object,
      "div",
      initializer,
      context.scopes,
    )
  )
    return false;
  const factorySymbol = context.scopes.symbolFor(factory.object);
  const factoryImport = factorySymbol?.declarationNode.parent;
  if (
    factorySymbol?.kind !== "import" ||
    !isNodeOfType(factoryImport, "ImportDeclaration") ||
    factoryImport.importKind === "type" ||
    (isNodeOfType(factorySymbol.declarationNode, "ImportSpecifier") &&
      factorySymbol.declarationNode.importKind === "type")
  )
    return false;
  const fragments: StyledScreenBoxFragment[] = [];
  for (let index = 0; index < initializer.quasi.quasis.length; index += 1) {
    const quasi = initializer.quasi.quasis[index];
    if (!quasi || quasi.value.cooked !== quasi.value.raw) return false;
    if (index > 0 && quasi.value.raw.replace(/&\s+img\s*\{[^{}]*\}/g, "").trim()) return false;
    fragments.push({ source: quasi.value.raw, minWidthPx: 0, maxWidthPx: Infinity });
    const expression = initializer.quasi.expressions[index];
    if (!expression) continue;
    if (!isNodeOfType(expression, "TaggedTemplateExpression")) return false;
    const bounds = getMediaBounds(expression, context, initializer);
    const source = getTemplateText(expression.quasi);
    if (!bounds || source === null) return false;
    fragments.push({ source, ...bounds });
  }
  return hasReservedStyledScreenBox(fragments);
};
