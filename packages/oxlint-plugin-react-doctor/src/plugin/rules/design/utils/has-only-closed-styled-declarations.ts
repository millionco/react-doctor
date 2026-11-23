import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const COLOR_TOKEN = /^(?:#[a-f0-9]{3}|#[a-f0-9]{6}|[a-z]+)$/i;
const FONT_WEIGHT_TOKEN = /^(?:normal|bold|[1-9]00)$/i;
const DECLARATION = /^([a-z][a-z-]*)\s*:\s*([ #a-z0-9.%+-]+)\s*;/i;
const LOCAL_RULE = /^(p|strong|&:hover)\s*\{([^{}]*)\}/i;

const readThemeColor = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  themeColors: ReadonlyMap<string, string>,
): string | undefined => {
  const callback = stripParenExpression(expression);
  if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return undefined;
  const [parameter] = callback.params;
  const body = stripParenExpression(callback.body);
  if (
    callback.params.length !== 1 ||
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(body, "MemberExpression") ||
    body.computed ||
    body.optional ||
    !isNodeOfType(body.property, "Identifier") ||
    !isNodeOfType(body.object, "MemberExpression") ||
    body.object.computed ||
    body.object.optional ||
    !isNodeOfType(body.object.property, "Identifier") ||
    body.object.property.name !== "theme" ||
    !isNodeOfType(body.object.object, "Identifier")
  ) {
    return undefined;
  }
  const parameterSymbol = scopes.symbolFor(parameter);
  if (!parameterSymbol || scopes.symbolFor(body.object.object) !== parameterSymbol)
    return undefined;
  const value = themeColors.get(body.property.name);
  return value && /^(?:#[a-f0-9]{3}|#[a-f0-9]{6})$/i.test(value) ? value : undefined;
};

const readClosedTemplateText = (
  template: EsTreeNodeOfType<"TemplateLiteral">,
  scopes: ScopeAnalysis,
  themeColors: ReadonlyMap<string, string>,
): string | null => {
  let text = "";
  for (let index = 0; index < template.quasis.length; index += 1) {
    const quasi = template.quasis[index];
    if (!quasi || quasi.value.cooked !== quasi.value.raw) return null;
    text += quasi.value.raw;
    const expression = template.expressions[index];
    if (!expression) continue;
    const value = readThemeColor(expression, scopes, themeColors);
    if (value === undefined) return null;
    text += value;
  }
  return text;
};

const isSupportedNestedDeclaration = (
  selector: string,
  property: string,
  value: string,
): boolean => {
  if (property === "color" || property === "background-color") return COLOR_TOKEN.test(value);
  if (selector === "&:hover") return false;
  if (property === "font-weight") return FONT_WEIGHT_TOKEN.test(value);
  return property === "display" && value === "inline";
};

const hasOnlySupportedNestedDeclarations = (selector: string, css: string): boolean => {
  let remainder = css.trim();
  while (remainder) {
    const declaration = DECLARATION.exec(remainder);
    if (!declaration?.[1] || !declaration[2]) return false;
    if (
      !isSupportedNestedDeclaration(
        selector,
        declaration[1].toLowerCase(),
        declaration[2].trim().toLowerCase(),
      )
    ) {
      return false;
    }
    remainder = remainder.slice(declaration[0].length).trimStart();
  }
  return true;
};

export const hasOnlyClosedStyledDeclarations = (
  template: EsTreeNodeOfType<"TemplateLiteral">,
  scopes: ScopeAnalysis,
  themeColors: ReadonlyMap<string, string>,
): boolean => {
  const text = readClosedTemplateText(template, scopes, themeColors);
  if (text === null) return false;
  let remainder = text.trim();
  while (remainder) {
    const declaration = DECLARATION.exec(remainder);
    if (declaration) {
      remainder = remainder.slice(declaration[0].length).trimStart();
      continue;
    }
    const nested = LOCAL_RULE.exec(remainder);
    if (!nested?.[1] || nested[2] === undefined) return false;
    if (!hasOnlySupportedNestedDeclarations(nested[1].toLowerCase(), nested[2])) return false;
    remainder = remainder.slice(nested[0].length).trimStart();
  }
  return true;
};
