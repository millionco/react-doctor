import type { Selector, SelectorComponent } from "lightningcss";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";

const INITIAL_STATE_EXCLUDED_PSEUDO_CLASSES = new Set([
  "active",
  "focus",
  "focus-visible",
  "focus-within",
  "hover",
]);

export enum StaticSelectorMatch {
  Ambiguous,
  Match,
  NoMatch,
}

interface RootSelectorMatch {
  readonly hasTargetAnchor: boolean;
  readonly match: StaticSelectorMatch;
}

interface StaticAttributeValue {
  readonly exists: boolean;
  readonly isDynamic: boolean;
  readonly value: string | null;
}

const combineSelectorMatches = (
  leftMatch: StaticSelectorMatch,
  rightMatch: StaticSelectorMatch,
): StaticSelectorMatch => {
  if (leftMatch === StaticSelectorMatch.NoMatch || rightMatch === StaticSelectorMatch.NoMatch) {
    return StaticSelectorMatch.NoMatch;
  }
  if (leftMatch === StaticSelectorMatch.Ambiguous || rightMatch === StaticSelectorMatch.Ambiguous) {
    return StaticSelectorMatch.Ambiguous;
  }
  return StaticSelectorMatch.Match;
};

const combineAlternativeSelectorMatches = (
  matches: ReadonlyArray<StaticSelectorMatch>,
): StaticSelectorMatch => {
  if (matches.includes(StaticSelectorMatch.Match)) return StaticSelectorMatch.Match;
  if (matches.includes(StaticSelectorMatch.Ambiguous)) return StaticSelectorMatch.Ambiguous;
  return StaticSelectorMatch.NoMatch;
};

const getStaticAttributeValue = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): StaticAttributeValue => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName, false);
  if (!attribute) return { exists: false, isDynamic: false, value: null };
  if (!attribute.value) return { exists: true, isDynamic: false, value: "" };
  const value = getStringLiteralAttributeValue(attribute);
  return value === null
    ? { exists: true, isDynamic: true, value: null }
    : { exists: true, isDynamic: false, value };
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

export const selectorMatches = (
  selector: Selector,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): StaticSelectorMatch => selectorMatchesAt(selector, selector.length - 1, node);

const selectorListMatches = (
  selectors: ReadonlyArray<Selector>,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): StaticSelectorMatch =>
  combineAlternativeSelectorMatches(selectors.map((selector) => selectorMatches(selector, node)));

const pseudoClassMatches = (
  component: Extract<SelectorComponent, { type: "pseudo-class" }>,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): StaticSelectorMatch => {
  if (INITIAL_STATE_EXCLUDED_PSEUDO_CLASSES.has(component.kind)) {
    return StaticSelectorMatch.NoMatch;
  }
  if (component.kind === "first-child" || component.kind === "last-child") {
    const position = getStaticElementPosition(node);
    if (!position) return StaticSelectorMatch.Ambiguous;
    const matches =
      component.kind === "first-child" ? position.index === 1 : position.index === position.total;
    return matches ? StaticSelectorMatch.Match : StaticSelectorMatch.NoMatch;
  }
  if (component.kind === "nth-child") {
    if (component.of) return StaticSelectorMatch.Ambiguous;
    const position = getStaticElementPosition(node);
    if (!position) return StaticSelectorMatch.Ambiguous;
    const difference = position.index - component.b;
    const matches =
      component.a === 0
        ? difference === 0
        : difference / component.a >= 0 && Number.isInteger(difference / component.a);
    return matches ? StaticSelectorMatch.Match : StaticSelectorMatch.NoMatch;
  }
  if (component.kind === "is" || component.kind === "where" || component.kind === "any") {
    return selectorListMatches(component.selectors, node);
  }
  if (component.kind === "not") {
    const match = selectorListMatches(component.selectors, node);
    if (match === StaticSelectorMatch.Match) return StaticSelectorMatch.NoMatch;
    if (match === StaticSelectorMatch.NoMatch) return StaticSelectorMatch.Match;
    return StaticSelectorMatch.Ambiguous;
  }
  if (component.kind === "local" || component.kind === "global") {
    return selectorMatches(component.selector, node);
  }
  return StaticSelectorMatch.Ambiguous;
};

const attributeSelectorMatches = (
  component: Extract<SelectorComponent, { type: "attribute" }>,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): StaticSelectorMatch => {
  const attribute = getStaticAttributeValue(node, component.name);
  if (!attribute.exists) return StaticSelectorMatch.NoMatch;
  if (!component.operation) return StaticSelectorMatch.Match;
  if (attribute.isDynamic || attribute.value === null) return StaticSelectorMatch.Ambiguous;
  const isCaseInsensitive = component.operation.caseSensitivity === "ascii-case-insensitive";
  const attributeValue = isCaseInsensitive ? attribute.value.toLowerCase() : attribute.value;
  const selectorValue = isCaseInsensitive
    ? component.operation.value.toLowerCase()
    : component.operation.value;
  let matches = false;
  if (component.operation.operator === "equal") matches = attributeValue === selectorValue;
  else if (component.operation.operator === "includes") {
    matches = attributeValue.split(/\s+/).includes(selectorValue);
  } else if (component.operation.operator === "dash-match") {
    matches = attributeValue === selectorValue || attributeValue.startsWith(`${selectorValue}-`);
  } else if (component.operation.operator === "prefix")
    matches = attributeValue.startsWith(selectorValue);
  else if (component.operation.operator === "substring")
    matches = attributeValue.includes(selectorValue);
  else if (component.operation.operator === "suffix")
    matches = attributeValue.endsWith(selectorValue);
  return matches ? StaticSelectorMatch.Match : StaticSelectorMatch.NoMatch;
};

const selectorComponentMatches = (
  component: SelectorComponent,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): StaticSelectorMatch => {
  if (component.type === "universal") return StaticSelectorMatch.Match;
  if (component.type === "type") {
    return resolveJsxElementType(node)?.toLowerCase() === component.name.toLowerCase()
      ? StaticSelectorMatch.Match
      : StaticSelectorMatch.NoMatch;
  }
  if (component.type === "class") {
    const className = getStaticAttributeValue(node, "className");
    if (!className.exists) return StaticSelectorMatch.NoMatch;
    if (className.isDynamic || className.value === null) return StaticSelectorMatch.Ambiguous;
    return className.value.split(/\s+/).includes(component.name)
      ? StaticSelectorMatch.Match
      : StaticSelectorMatch.NoMatch;
  }
  if (component.type === "id") {
    const id = getStaticAttributeValue(node, "id");
    if (!id.exists) return StaticSelectorMatch.NoMatch;
    if (id.isDynamic) return StaticSelectorMatch.Ambiguous;
    return id.value === component.name ? StaticSelectorMatch.Match : StaticSelectorMatch.NoMatch;
  }
  if (component.type === "attribute") return attributeSelectorMatches(component, node);
  if (component.type === "pseudo-class") return pseudoClassMatches(component, node);
  if (component.type === "pseudo-element") return StaticSelectorMatch.NoMatch;
  return StaticSelectorMatch.Ambiguous;
};

const selectorMatchesAt = (
  selector: Selector,
  componentIndex: number,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): StaticSelectorMatch => {
  let compoundStartIndex = componentIndex;
  while (compoundStartIndex >= 0 && selector[compoundStartIndex].type !== "combinator") {
    compoundStartIndex -= 1;
  }
  let compoundMatch = StaticSelectorMatch.Match;
  for (let index = compoundStartIndex + 1; index <= componentIndex; index += 1) {
    compoundMatch = combineSelectorMatches(
      compoundMatch,
      selectorComponentMatches(selector[index], node),
    );
    if (compoundMatch === StaticSelectorMatch.NoMatch) return compoundMatch;
  }
  if (compoundStartIndex < 0) return compoundMatch;
  const combinator = selector[compoundStartIndex];
  if (combinator.type !== "combinator") return StaticSelectorMatch.Ambiguous;
  const previousComponentIndex = compoundStartIndex - 1;
  if (combinator.value === "child") {
    const parent = getParentOpeningElement(node);
    return parent
      ? combineSelectorMatches(
          compoundMatch,
          selectorMatchesAt(selector, previousComponentIndex, parent),
        )
      : StaticSelectorMatch.NoMatch;
  }
  if (combinator.value === "descendant") {
    let ancestor = getParentOpeningElement(node);
    let ancestorMatch = StaticSelectorMatch.NoMatch;
    while (ancestor) {
      ancestorMatch = combineAlternativeSelectorMatches([
        ancestorMatch,
        selectorMatchesAt(selector, previousComponentIndex, ancestor),
      ]);
      ancestor = getParentOpeningElement(ancestor);
    }
    return combineSelectorMatches(compoundMatch, ancestorMatch);
  }
  return StaticSelectorMatch.Ambiguous;
};

export const selectorMatchesRootTarget = (
  selector: Selector,
  target: "body" | "html" | "root",
): RootSelectorMatch => {
  let hasTargetAnchor = false;
  let match = StaticSelectorMatch.Match;
  for (const component of selector) {
    if (component.type === "combinator" || component.type === "pseudo-element") {
      return { hasTargetAnchor: false, match: StaticSelectorMatch.NoMatch };
    }
    if (component.type === "type") {
      const componentMatches = target !== "root" && component.name.toLowerCase() === target;
      if (!componentMatches) return { hasTargetAnchor: false, match: StaticSelectorMatch.NoMatch };
      hasTargetAnchor = true;
    } else if (component.type === "id") {
      if (target !== "root" || component.name !== "root") {
        return { hasTargetAnchor: false, match: StaticSelectorMatch.NoMatch };
      }
      hasTargetAnchor = true;
    } else if (component.type !== "universal") {
      match = StaticSelectorMatch.Ambiguous;
    }
  }
  return {
    hasTargetAnchor,
    match: hasTargetAnchor ? match : StaticSelectorMatch.NoMatch,
  };
};
