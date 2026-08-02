import * as fs from "node:fs";
import * as path from "node:path";
import {
  CROSS_FILE_PARSE_MAX_BYTES,
  STATIC_CSS_SELECTOR_EXPANSION_MAX_COUNT,
} from "../../../constants/thresholds.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { recordContentProbe } from "../../../utils/cross-file-probe-recorder.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";

const TRACKED_CSS_PROPERTIES = new Set([
  "align-items",
  "align-self",
  "aspect-ratio",
  "display",
  "flex",
  "flex-direction",
  "flex-grow",
  "flex-wrap",
  "height",
  "width",
]);
const REACT_ROOT_HEIGHT_TARGETS: ReadonlyArray<"body" | "html" | "root"> = ["html", "body", "root"];
const CSS_PSEUDO_ELEMENT_PATTERN = /::|:(?:after|before|first-letter|first-line)\b/i;
const CSS_INTERACTION_PSEUDO_CLASS_PATTERN =
  /:(?:active|focus|focus-visible|focus-within|hover)\b/i;
const STATIC_CSS_IMPORT_PATTERN =
  /(?:^|[;\n])\s*import\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+\.css(?:[?#][^"']*)?)["']/gm;

interface CssRule {
  readonly declarations: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly selectors: ReadonlyArray<StaticCssSelector>;
}

interface StaticCssCompoundSelector {
  readonly classNames: ReadonlyArray<string>;
  readonly elementName: string | null;
  readonly id: string | null;
  readonly position: number | "first" | "last" | null;
}

interface StaticCssSelector {
  readonly combinators: ReadonlyArray<">" | " ">;
  readonly compounds: ReadonlyArray<StaticCssCompoundSelector>;
}

interface ParsedStylesheets {
  readonly ambiguousProperties: ReadonlySet<string>;
  readonly ambiguousRules: ReadonlyArray<CssRule>;
  readonly rules: ReadonlyArray<CssRule>;
}

export interface StaticCssStyle {
  readonly ambiguousProperties: ReadonlySet<string>;
  readonly valuesByProperty: ReadonlyMap<string, ReadonlyArray<string>>;
}

export interface StaticCssStyleResolver {
  readonly hasDefiniteReactRootHeight: boolean;
  readonly resolve: (node: EsTreeNodeOfType<"JSXOpeningElement">) => StaticCssStyle;
}

const removeCssComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");

const splitTopLevel = (source: string, delimiter: string): string[] => {
  const parts: string[] = [];
  let startIndex = 0;
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parenthesisDepth += 1;
    else if (character === ")") parenthesisDepth -= 1;
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth -= 1;
    else if (character === delimiter && parenthesisDepth === 0 && bracketDepth === 0) {
      parts.push(source.slice(startIndex, index));
      startIndex = index + 1;
    }
  }
  parts.push(source.slice(startIndex));
  return parts;
};

const findMatchingBraceIndex = (source: string, openingBraceIndex: number): number => {
  let braceDepth = 1;
  let quote: string | null = null;
  for (let index = openingBraceIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") braceDepth += 1;
    else if (character === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) return index;
    }
  }
  return -1;
};

const parseDeclarations = (source: string): ReadonlyMap<string, ReadonlyArray<string>> => {
  const valuesByProperty = new Map<string, string[]>();
  for (const declaration of splitTopLevel(source, ";")) {
    const colonIndex = declaration.indexOf(":");
    if (colonIndex < 0) continue;
    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    if (!TRACKED_CSS_PROPERTIES.has(property)) continue;
    const value = declaration
      .slice(colonIndex + 1)
      .trim()
      .toLowerCase()
      .replace(/\s*!important\s*$/, "")
      .trim();
    if (!value) continue;
    const values = valuesByProperty.get(property) ?? [];
    values.push(value);
    valuesByProperty.set(property, values);
  }
  return valuesByProperty;
};

const parseCompoundSelector = (source: string): StaticCssCompoundSelector | null => {
  const match =
    /^(\*|[a-z][\w-]*)?((?:[.#][\w-]+)*)(?::(first-child|last-child|nth-child\([1-9]\d*\)))?$/i.exec(
      source,
    );
  if (!match) return null;
  const qualifiers = match[2] ?? "";
  const classNames = [...qualifiers.matchAll(/\.([\w-]+)/g)].map((classMatch) => classMatch[1]);
  const idMatches = [...qualifiers.matchAll(/#([\w-]+)/g)];
  if (idMatches.length > 1) return null;
  const positionSource = match[3] ?? null;
  const position =
    positionSource === "first-child"
      ? "first"
      : positionSource === "last-child"
        ? "last"
        : positionSource?.startsWith("nth-child(")
          ? Number(positionSource.slice(10, -1))
          : null;
  return {
    classNames,
    elementName: match[1] && match[1] !== "*" ? match[1].toLowerCase() : null,
    id: idMatches[0]?.[1] ?? null,
    position,
  };
};

const parseSelector = (source: string): StaticCssSelector | null => {
  const normalizedSource = source
    .trim()
    .replace(/\s*>\s*/g, ">")
    .replace(/\s+/g, " ");
  if (!normalizedSource || /[+~[\]]/.test(normalizedSource)) return null;
  const tokens = normalizedSource.split(/([> ])/).filter(Boolean);
  const compounds: StaticCssCompoundSelector[] = [];
  const combinators: Array<">" | " "> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (index % 2 === 0) {
      const compound = parseCompoundSelector(tokens[index]);
      if (!compound) return null;
      compounds.push(compound);
    } else if (tokens[index] === ">") {
      combinators.push(">");
    } else if (tokens[index] === " ") {
      combinators.push(" ");
    } else {
      return null;
    }
  }
  if (compounds.length !== combinators.length + 1) return null;
  return { combinators, compounds };
};

const expandStaticSelectorFunctions = (source: string): string[] | null => {
  const pendingSources = [source];
  const expandedSources: string[] = [];
  while (pendingSources.length > 0) {
    const currentSource = pendingSources.pop();
    if (currentSource === undefined) break;
    const functionMatch = /:(?:is|where)\(/i.exec(currentSource);
    if (!functionMatch) {
      expandedSources.push(currentSource);
      continue;
    }
    const bodyStartIndex = functionMatch.index + functionMatch[0].length;
    let parenthesisDepth = 1;
    let quote: string | null = null;
    let closingParenthesisIndex = -1;
    for (let index = bodyStartIndex; index < currentSource.length; index += 1) {
      const character = currentSource[index];
      if (quote !== null) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "(") parenthesisDepth += 1;
      else if (character === ")") {
        parenthesisDepth -= 1;
        if (parenthesisDepth === 0) {
          closingParenthesisIndex = index;
          break;
        }
      }
    }
    if (closingParenthesisIndex < 0) return null;
    const branches = splitTopLevel(
      currentSource.slice(bodyStartIndex, closingParenthesisIndex),
      ",",
    )
      .map((branch) => branch.trim())
      .filter(Boolean);
    if (
      branches.length === 0 ||
      pendingSources.length + expandedSources.length + branches.length >
        STATIC_CSS_SELECTOR_EXPANSION_MAX_COUNT
    ) {
      return null;
    }
    const prefix = currentSource.slice(0, functionMatch.index);
    const suffix = currentSource.slice(closingParenthesisIndex + 1);
    for (const branch of branches) pendingSources.push(`${prefix}${branch}${suffix}`);
  }
  return expandedSources;
};

const parseSelectors = (source: string): StaticCssSelector[] =>
  (expandStaticSelectorFunctions(source) ?? []).flatMap((expandedSource) => {
    const selector = parseSelector(expandedSource);
    return selector ? [selector] : [];
  });

const parsePotentiallyMatchingSelectors = (source: string): StaticCssSelector[] => {
  if (/:+(?:has|not)\(/i.test(source) || CSS_INTERACTION_PSEUDO_CLASS_PATTERN.test(source)) {
    return [];
  }
  const withoutDynamicPseudoClasses = source.replace(
    /:(?:any-link|checked|default|disabled|empty|enabled|indeterminate|link|optional|required|target|valid|visited)\b/gi,
    "",
  );
  return parseSelectors(withoutDynamicPseudoClasses);
};

const addAmbiguousDeclarations = (
  declarations: ReadonlyMap<string, ReadonlyArray<string>>,
  ambiguousProperties: Set<string>,
): void => {
  for (const property of declarations.keys()) ambiguousProperties.add(property);
};

const parseStylesheet = (source: string): ParsedStylesheets => {
  const normalizedSource = removeCssComments(source);
  const rules: CssRule[] = [];
  const ambiguousRules: CssRule[] = [];
  const ambiguousProperties = new Set<string>();
  let segmentStartIndex = 0;
  for (let index = 0; index < normalizedSource.length; index += 1) {
    const character = normalizedSource[index];
    if (character === ";") {
      segmentStartIndex = index + 1;
      continue;
    }
    if (character !== "{") continue;
    const closingBraceIndex = findMatchingBraceIndex(normalizedSource, index);
    if (closingBraceIndex < 0) break;
    const prelude = normalizedSource.slice(segmentStartIndex, index).trim();
    const body = normalizedSource.slice(index + 1, closingBraceIndex);
    const declarations = parseDeclarations(body);
    if (prelude.startsWith("@")) {
      if (body.includes("{")) {
        const nestedStylesheet = parseStylesheet(body);
        if (/^@layer(?:\s|$)/i.test(prelude)) {
          rules.push(...nestedStylesheet.rules);
          ambiguousRules.push(...nestedStylesheet.ambiguousRules);
        } else {
          ambiguousRules.push(...nestedStylesheet.rules, ...nestedStylesheet.ambiguousRules);
        }
        for (const property of nestedStylesheet.ambiguousProperties) {
          ambiguousProperties.add(property);
        }
      } else {
        addAmbiguousDeclarations(declarations, ambiguousProperties);
      }
    } else if (declarations.size > 0) {
      const selectors: StaticCssSelector[] = [];
      for (const selectorSource of splitTopLevel(prelude, ",")) {
        if (CSS_PSEUDO_ELEMENT_PATTERN.test(selectorSource)) continue;
        const parsedSelectors = parseSelectors(selectorSource);
        if (parsedSelectors.length > 0) selectors.push(...parsedSelectors);
        else {
          const potentiallyMatchingSelectors = parsePotentiallyMatchingSelectors(selectorSource);
          if (potentiallyMatchingSelectors.length > 0) {
            ambiguousRules.push({ declarations, selectors: potentiallyMatchingSelectors });
          }
        }
      }
      if (selectors.length > 0) rules.push({ declarations, selectors });
    }
    index = closingBraceIndex;
    segmentStartIndex = closingBraceIndex + 1;
  }
  return { ambiguousProperties, ambiguousRules, rules };
};

const getStaticAttributeValue = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): string | null => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName, false);
  return attribute ? getStringLiteralAttributeValue(attribute) : null;
};

const getParentOpeningElement = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  const element = node.parent;
  const parentElement = element?.parent;
  return isNodeOfType(element, "JSXElement") && isNodeOfType(parentElement, "JSXElement")
    ? parentElement.openingElement
    : null;
};

const getStaticElementPosition = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): { index: number; total: number } | null => {
  const element = node.parent;
  const parentElement = element?.parent;
  if (!isNodeOfType(element, "JSXElement") || !isNodeOfType(parentElement, "JSXElement")) {
    return null;
  }
  const siblings: EsTreeNodeOfType<"JSXElement">[] = [];
  for (const child of parentElement.children) {
    if (isNodeOfType(child, "JSXElement")) siblings.push(child);
    else if (!isNodeOfType(child, "JSXText") || child.value.trim().length > 0) return null;
  }
  const index = siblings.indexOf(element);
  return index < 0 ? null : { index: index + 1, total: siblings.length };
};

const compoundMatches = (
  compound: StaticCssCompoundSelector,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const elementName = resolveJsxElementType(node)?.toLowerCase() ?? null;
  if (compound.elementName !== null && compound.elementName !== elementName) return false;
  const classNames = new Set((getStaticAttributeValue(node, "className") ?? "").split(/\s+/));
  if (compound.classNames.some((className) => !classNames.has(className))) return false;
  if (compound.id !== null && getStaticAttributeValue(node, "id") !== compound.id) return false;
  if (compound.position === null) return true;
  const position = getStaticElementPosition(node);
  if (!position) return false;
  if (compound.position === "first") return position.index === 1;
  if (compound.position === "last") return position.index === position.total;
  return position.index === compound.position;
};

const selectorMatchesAt = (
  selector: StaticCssSelector,
  compoundIndex: number,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (!compoundMatches(selector.compounds[compoundIndex], node)) return false;
  if (compoundIndex === 0) return true;
  const parent = getParentOpeningElement(node);
  if (!parent) return false;
  if (selector.combinators[compoundIndex - 1] === ">") {
    return selectorMatchesAt(selector, compoundIndex - 1, parent);
  }
  let ancestor: EsTreeNodeOfType<"JSXOpeningElement"> | null = parent;
  while (ancestor !== null) {
    if (selectorMatchesAt(selector, compoundIndex - 1, ancestor)) return true;
    ancestor = getParentOpeningElement(ancestor);
  }
  return false;
};

const selectorMatches = (
  selector: StaticCssSelector,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => selectorMatchesAt(selector, selector.compounds.length - 1, node);

const selectorMatchesRootTarget = (
  selector: StaticCssSelector,
  target: "body" | "html" | "root",
): boolean => {
  if (selector.compounds.length !== 1) return false;
  const compound = selector.compounds[0];
  if (compound.classNames.length > 0 || compound.position !== null) return false;
  if (target === "root") return compound.id === "root";
  return compound.id === null && compound.elementName === target;
};

const stylesheetsHaveDefiniteReactRootHeight = (stylesheets: ParsedStylesheets): boolean => {
  if (stylesheets.ambiguousProperties.has("height")) return false;
  return REACT_ROOT_HEIGHT_TARGETS.every((target) => {
    const hasAmbiguousHeight = stylesheets.ambiguousRules.some(
      (rule) =>
        rule.declarations.has("height") &&
        rule.selectors.some((selector) => selectorMatchesRootTarget(selector, target)),
    );
    if (hasAmbiguousHeight) return false;
    const values = stylesheets.rules.flatMap((rule) =>
      rule.selectors.some((selector) => selectorMatchesRootTarget(selector, target))
        ? (rule.declarations.get("height") ?? [])
        : [],
    );
    return values.length > 0 && values.every((value) => value === "100%");
  });
};

const findImportedSiblingStylesheetPaths = (filename: string): ReadonlySet<string> => {
  const importedStylesheetPaths = new Set<string>();
  const directoryPath = path.dirname(filename);
  try {
    const fileStat = fs.statSync(filename);
    if (fileStat.size > CROSS_FILE_PARSE_MAX_BYTES) return importedStylesheetPaths;
    const source = fs.readFileSync(filename, "utf8");
    for (const match of source.matchAll(STATIC_CSS_IMPORT_PATTERN)) {
      const importSource = match[1].split(/[?#]/, 1)[0];
      if (!importSource.startsWith(".")) continue;
      const stylesheetPath = path.resolve(directoryPath, importSource);
      if (path.dirname(stylesheetPath) === directoryPath) {
        importedStylesheetPaths.add(stylesheetPath);
      }
    }
  } catch {}
  return importedStylesheetPaths;
};

const loadSiblingStylesheets = (filename: string): ParsedStylesheets => {
  const rules: CssRule[] = [];
  const ambiguousRules: CssRule[] = [];
  const ambiguousProperties = new Set<string>();
  let directoryEntries: fs.Dirent[];
  try {
    directoryEntries = fs.readdirSync(path.dirname(filename), { withFileTypes: true });
  } catch {
    return { ambiguousProperties, ambiguousRules, rules };
  }
  const directoryPath = path.dirname(filename);
  const importedStylesheetPaths = findImportedSiblingStylesheetPaths(filename);
  for (const entry of directoryEntries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".css")) continue;
    const stylesheetPath = path.join(directoryPath, entry.name);
    if (!importedStylesheetPaths.has(stylesheetPath)) continue;
    recordContentProbe(stylesheetPath);
    try {
      const fileStat = fs.statSync(stylesheetPath);
      if (fileStat.size > CROSS_FILE_PARSE_MAX_BYTES) continue;
      const parsed = parseStylesheet(fs.readFileSync(stylesheetPath, "utf8"));
      rules.push(...parsed.rules);
      ambiguousRules.push(...parsed.ambiguousRules);
      for (const property of parsed.ambiguousProperties) ambiguousProperties.add(property);
    } catch {}
  }
  return { ambiguousProperties, ambiguousRules, rules };
};

export const createStaticCssStyleResolver = (
  filename: string | undefined,
): StaticCssStyleResolver => {
  let stylesheets: ParsedStylesheets | null = null;
  const getStylesheets = (): ParsedStylesheets => {
    stylesheets ??=
      filename && path.isAbsolute(filename)
        ? loadSiblingStylesheets(filename)
        : { ambiguousProperties: new Set(), ambiguousRules: [], rules: [] };
    return stylesheets;
  };
  return {
    get hasDefiniteReactRootHeight() {
      return stylesheetsHaveDefiniteReactRootHeight(getStylesheets());
    },
    resolve: (node) => {
      if (!filename || !path.isAbsolute(filename)) {
        return { ambiguousProperties: new Set(), valuesByProperty: new Map() };
      }
      const loadedStylesheets = getStylesheets();
      const valuesByProperty = new Map<string, string[]>();
      for (const rule of loadedStylesheets.rules) {
        if (!rule.selectors.some((selector) => selectorMatches(selector, node))) continue;
        for (const [property, ruleValues] of rule.declarations) {
          const values = valuesByProperty.get(property) ?? [];
          values.push(...ruleValues);
          valuesByProperty.set(property, values);
        }
      }
      const ambiguousProperties = new Set(loadedStylesheets.ambiguousProperties);
      for (const rule of loadedStylesheets.ambiguousRules) {
        if (!rule.selectors.some((selector) => selectorMatches(selector, node))) continue;
        for (const property of rule.declarations.keys()) ambiguousProperties.add(property);
      }
      return { ambiguousProperties, valuesByProperty };
    },
  };
};
