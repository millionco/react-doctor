import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getIconLibraryFamily } from "../../utils/get-icon-library-family.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";

const MESSAGE =
  "Blind users can't tell what this control does because screen readers find no label, so add visible text, `aria-label`, or `aria-labelledby`.";

interface ControlHasAssociatedLabelSettings {
  depth?: number;
  labelAttributes?: ReadonlyArray<string>;
  controlComponents?: ReadonlyArray<string>;
  ignoreElements?: ReadonlyArray<string>;
  ignoreRoles?: ReadonlyArray<string>;
}

// `link` is upstream's only default-ignored element. We add `canvas`
// because a canvas is a drawing surface — it can't have a *text label*
// (its child text is a screen-reader fallback that doesn't satisfy the
// rule's "labelled control" model), and almost every flagged hit in
// real codebases is unactionable (devtools overlays, internal SDK
// canvases, etc.). Users who genuinely need labels on canvases (rare)
// set `aria-label` and the labelling-prop check passes; users who want
// to enforce regardless can override via `ignoreElements: []`.

// OXC's interactive-element list includes td/th/tr/option/datalist and
// audio/video, but none of them is an operable control a user labels:
// table cells are layout (skeleton/spacer cells fire constantly), an
// option's accessible name is its value/text by spec, and media
// elements either render self-labelled native controls (`controls`) or
// are passive playback surfaces. Elements that opt into a real widget
// role (e.g. `<td role="button">`) still go through the role path.
const NON_OPERABLE_ELEMENTS: ReadonlySet<string> = new Set([
  "td",
  "th",
  "tr",
  "option",
  "datalist",
  "audio",
  "video",
]);

// `role="separator"` is only a focusable widget when the author makes
// it one; the overwhelmingly common usage is a static decorative
// divider that needs no accessible name.
const SEPARATOR_ROLE = "separator";

// Input types whose accessible name falls back to `placeholder` per
// HTML-AAM (plus textarea, handled by tag).
const PLACEHOLDER_NAMEABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
]);

// Only Tailwind's `hidden` (display: none) qualifies: it removes the
// input from the accessibility tree AND the tab order, so the only way
// to reach it is the programmatic trigger. sr-only-family classes
// deliberately KEEP the element focusable — an AT user tabs to an
// unnamed file control, which is a genuine violation.
const DISPLAY_NONE_CLASS_TOKEN = "hidden";

const isDisplayNoneClassToken = (token: string): boolean =>
  token.toLowerCase() === DISPLAY_NONE_CLASS_TOKEN;

// Tokens from a multi-quasi template's static chunks, keeping only
// whitespace-bounded tokens: a quasi edge adjacent to an expression is
// not a token boundary, so `` `hidden ${x}` `` yields "hidden" but
// `` `${x}den` `` / `` `hid${x}` `` yield nothing.
const collectStaticTemplateClassTokens = (
  templateLiteral: EsTreeNodeOfType<"TemplateLiteral">,
): ReadonlyArray<string> => {
  const quasis = templateLiteral.quasis ?? [];
  const tokens: string[] = [];
  for (const [quasiIndex, quasi] of quasis.entries()) {
    const quasiText = quasi.value?.cooked ?? quasi.value?.raw ?? "";
    const quasiTokens = splitTailwindClassName(quasiText);
    if (quasiTokens.length === 0) continue;
    const isCutByLeadingExpression = quasiIndex > 0 && !/^\s/.test(quasiText);
    const isCutByTrailingExpression = quasiIndex < quasis.length - 1 && !/\s$/.test(quasiText);
    if (isCutByLeadingExpression) quasiTokens.shift();
    if (isCutByTrailingExpression) quasiTokens.pop();
    tokens.push(...quasiTokens);
  }
  return tokens;
};

const hasDisplayNoneClass = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classAttribute =
    hasJsxPropIgnoreCase(opening.attributes, "className") ??
    hasJsxPropIgnoreCase(opening.attributes, "class");
  if (!classAttribute) return false;
  const literalValue = getStringLiteralAttributeValue(classAttribute);
  if (literalValue !== null) {
    return splitTailwindClassName(literalValue).some(isDisplayNoneClassToken);
  }
  if (
    classAttribute.value &&
    isNodeOfType(classAttribute.value, "JSXExpressionContainer") &&
    isNodeOfType(classAttribute.value.expression, "TemplateLiteral")
  ) {
    return collectStaticTemplateClassTokens(classAttribute.value.expression).some(
      isDisplayNoneClassToken,
    );
  }
  return false;
};

// The `hidden` attribute removes the element from the accessibility
// tree entirely (and from the tab order), so no user — sighted or
// blind — can reach it; a label serves nobody. A literal `false` (or
// the authored string "false") signals intent to show, everything
// else — bare attribute, any other string, a dynamic expression — is
// treated as hidden (ambiguous → prefer not firing).
const hasHiddenAttribute = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const hiddenAttribute = hasJsxPropIgnoreCase(opening.attributes, "hidden");
  if (!hiddenAttribute) return false;
  const value = hiddenAttribute.value;
  if (!value) return true;
  if (isNodeOfType(value, "Literal")) {
    return value.value !== "false" && Boolean(value.value);
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = stripParenExpression(value.expression as EsTreeNode);
    if (isNodeOfType(expression, "Literal")) return Boolean(expression.value);
  }
  return true;
};

const HIDDEN_STYLE_VALUES_BY_PROPERTY: Readonly<Record<string, string>> = {
  display: "none",
  visibility: "hidden",
};

// `style={{ display: "none" }}` / `style={{ visibility: "hidden" }}`
// with a static literal value — the standard hidden-file-input /
// submit-proxy pattern.
const hasStaticHiddenStyle = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const styleAttribute = hasJsxPropIgnoreCase(opening.attributes, "style");
  if (!styleAttribute?.value) return false;
  if (!isNodeOfType(styleAttribute.value, "JSXExpressionContainer")) return false;
  const styleExpression = stripParenExpression(styleAttribute.value.expression as EsTreeNode);
  if (!isNodeOfType(styleExpression, "ObjectExpression")) return false;
  for (const property of styleExpression.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;
    const key = property.key as EsTreeNode;
    const propertyName = isNodeOfType(key, "Identifier")
      ? key.name
      : isNodeOfType(key, "Literal") && typeof key.value === "string"
        ? key.value
        : null;
    if (!propertyName) continue;
    const hiddenValue = HIDDEN_STYLE_VALUES_BY_PROPERTY[propertyName];
    if (!hiddenValue) continue;
    const propertyValue = stripParenExpression(property.value as EsTreeNode);
    if (isNodeOfType(propertyValue, "Literal") && propertyValue.value === hiddenValue) return true;
  }
  return false;
};

const isElementInlineHidden = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean =>
  isHiddenFromScreenReader(opening, settings) ||
  hasHiddenAttribute(opening) ||
  hasStaticHiddenStyle(opening);

// A `<input type="file">` that is display-none hidden AND wired to a ref
// is opened programmatically (`fileInputRef.current?.click()`) from a
// separate, already-labeled button. Requiring it to carry its own label
// is a false positive — the accessible name lives on the trigger.
const isProgrammaticHiddenFileInput = (
  tagName: string,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (tagName.toLowerCase() !== "input") return false;
  const typeAttribute = hasJsxPropIgnoreCase(opening.attributes, "type");
  const typeValue = typeAttribute ? getJsxPropStringValue(typeAttribute) : null;
  if (!typeValue || typeValue.toLowerCase() !== "file") return false;
  if (!hasDisplayNoneClass(opening)) return false;
  return Boolean(hasJsxPropIgnoreCase(opening.attributes, "ref"));
};

const DEFAULT_IGNORE_ELEMENTS: ReadonlyArray<string> = ["link", "canvas"];
const DEFAULT_LABELLING_PROPS: ReadonlySet<string> = new Set([
  "alt",
  "aria-label",
  "aria-labelledby",
]);
const ID_ATTRIBUTE = "id";
const HTML_FOR_ATTRIBUTE = "htmlFor";
const LABEL_ELEMENT = "label";
// Design systems routinely export a `Label` component (styled.label /
// Radix Label / shadcn Label) that renders an html `<label>` wrapping
// its children — treat it like the element when it carries text.
const LABEL_COMPONENT_NAME = "Label";
// MUI-style polymorphic escape hatch: `<Button component="label">`
// renders an html <label>, implicitly labelling the control inside.
const POLYMORPHIC_COMPONENT_PROP = "component";
const TITLE_ATTRIBUTE = "title";
// A wrapper like `<Field label="Hotkey"><input/></Field>` injects the
// association (htmlFor/id pair or a wrapping <label>) for its child
// control — the visible name exists, it just lives on the wrapper.
const WRAPPER_LABEL_PROP = "label";
const SELECT_ELEMENT = "select";

// Default depth for the children-walk. Upstream `eslint-plugin-jsx-a11y`
// defaults to 2, but real-world buttons routinely nest text deeper
// (icon + label inside flex wrappers easily reaches depth 4-5). The
// shallow default makes the rule miss visible text labels and emit
// false positives at scale.
const DEFAULT_DEPTH = 5;
const MAX_DEPTH = 25;

// Test / story / Cypress files don't participate in production
// accessibility audits — they exercise component shapes, not user
// flows. Skipping them removes a steady stream of FPs (test fixtures
// rendering bare `<input ref={...}/>` without labels). Shared helper
// is in `utils/is-testlike-filename.ts`.

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<ControlHasAssociatedLabelSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { controlHasAssociatedLabel?: ControlHasAssociatedLabelSettings })
          .controlHasAssociatedLabel ?? {})
      : {};
  return {
    depth: Math.min(ruleSettings.depth ?? DEFAULT_DEPTH, MAX_DEPTH),
    labelAttributes: ruleSettings.labelAttributes ?? [],
    controlComponents: ruleSettings.controlComponents ?? [],
    ignoreElements: ruleSettings.ignoreElements ?? [],
    ignoreRoles: ruleSettings.ignoreRoles ?? [],
  };
};

// Returns true if any attribute on this opening element provides an
// accessible name (per OXC's `has_labelling_prop`). Spread attributes
// always count.
const hasLabellingProp = (
  attributes: ReadonlyArray<EsTreeNode>,
  customAttributes: ReadonlyArray<string>,
): boolean => {
  const customAttributeNames = new Set(customAttributes);
  for (const attribute of attributes) {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) return true;
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name as EsTreeNode, "JSXIdentifier")) continue;
    const propName = getJsxAttributeName(attribute.name as EsTreeNodeOfType<"JSXIdentifier">);
    if (!propName) continue;
    const isLabelling = DEFAULT_LABELLING_PROPS.has(propName) || customAttributeNames.has(propName);
    if (!isLabelling) continue;
    if (!attribute.value) return false; // present but valueless
    if (isNodeOfType(attribute.value, "Literal") && typeof attribute.value.value === "string") {
      return attribute.value.value.trim().length > 0;
    }
    return true;
  }
  return false;
};

const hasNonEmptyPropValue = (attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined): boolean => {
  if (!attribute?.value) return false;
  const value = attribute.value;
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" ? value.value.trim().length > 0 : Boolean(value.value);
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = stripParenExpression(value.expression as EsTreeNode);
    if (isNodeOfType(expression, "JSXEmptyExpression")) return false;
    if (isNodeOfType(expression, "Literal")) {
      return typeof expression.value === "string"
        ? expression.value.trim().length > 0
        : Boolean(expression.value);
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      const staticValue = getStaticTemplateLiteralValue(expression);
      if (staticValue !== null) return staticValue.trim().length > 0;
    }
    return true;
  }
  return true;
};

const getLastJsxPropIgnoreCase = (
  attributes: ReadonlyArray<EsTreeNode>,
  targetProp: string,
): EsTreeNodeOfType<"JSXAttribute"> | undefined => {
  const targetPropLower = targetProp.toLowerCase();
  for (let attributeIndex = attributes.length - 1; attributeIndex >= 0; attributeIndex -= 1) {
    const attribute = attributes[attributeIndex];
    if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    if (attributeName?.toLowerCase() === targetPropLower) return attribute;
  }
  return undefined;
};

const getStaticNativeTitleArrayValue = (
  expression: EsTreeNodeOfType<"ArrayExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  const elementValues: string[] = [];
  for (const rawElement of expression.elements) {
    if (rawElement === null) {
      elementValues.push("");
      continue;
    }
    if (isNodeOfType(rawElement, "SpreadElement")) return null;
    const element = stripParenExpression(rawElement);
    if (isNodeOfType(element, "Literal")) {
      elementValues.push(element.value === null ? "" : String(element.value));
      continue;
    }
    if (isNodeOfType(element, "TemplateLiteral")) {
      const staticValue = getStaticTemplateLiteralValue(element);
      if (staticValue === null) return null;
      elementValues.push(staticValue);
      continue;
    }
    if (
      (isNodeOfType(element, "Identifier") &&
        element.name === "undefined" &&
        scopes.isGlobalReference(element)) ||
      (isNodeOfType(element, "UnaryExpression") && element.operator === "void")
    ) {
      elementValues.push("");
      continue;
    }
    if (isNodeOfType(element, "ArrayExpression")) {
      const nestedValue = getStaticNativeTitleArrayValue(element, scopes);
      if (nestedValue === null) return null;
      elementValues.push(nestedValue);
      continue;
    }
    return null;
  }
  return elementValues.join(",");
};

const isGlobalSymbolExpression = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(expression, "Identifier")) {
    return expression.name === "Symbol" && scopes.isGlobalReference(expression);
  }
  if (!isNodeOfType(expression, "MemberExpression")) return false;
  const object = stripParenExpression(expression.object);
  return (
    isNodeOfType(object, "Identifier") &&
    object.name === "Symbol" &&
    scopes.isGlobalReference(object)
  );
};

const hasNonEmptyNativeTitleExpression = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "string") return expression.value.trim().length > 0;
    return expression.value !== null && typeof expression.value !== "boolean";
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(expression);
    return staticValue === null || staticValue.trim().length > 0;
  }
  if (isNodeOfType(expression, "Identifier")) {
    return expression.name !== "undefined" || !scopes.isGlobalReference(expression);
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
    return false;
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") return false;
  if (isNodeOfType(expression, "ArrowFunctionExpression")) return false;
  if (isNodeOfType(expression, "FunctionExpression")) return false;
  if (isNodeOfType(expression, "ClassExpression")) return false;
  if (isNodeOfType(expression, "ArrayExpression")) {
    const staticValue = getStaticNativeTitleArrayValue(expression, scopes);
    return staticValue === null || staticValue.trim().length > 0;
  }
  if (isGlobalSymbolExpression(expression, scopes)) return false;
  if (
    isNodeOfType(expression, "CallExpression") &&
    isGlobalSymbolExpression(expression.callee, scopes)
  ) {
    return false;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      hasNonEmptyNativeTitleExpression(expression.consequent, scopes) &&
      hasNonEmptyNativeTitleExpression(expression.alternate, scopes)
    );
  }
  if (isNodeOfType(expression, "SequenceExpression")) {
    const finalExpression = expression.expressions.at(-1);
    return finalExpression ? hasNonEmptyNativeTitleExpression(finalExpression, scopes) : false;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    const leftExpression = stripParenExpression(expression.left);
    if (!isNodeOfType(leftExpression, "Literal")) {
      return expression.operator !== "&&";
    }
    if (expression.operator === "??") {
      return hasNonEmptyNativeTitleExpression(
        leftExpression.value === null ? expression.right : leftExpression,
        scopes,
      );
    }
    const leftValueIsTruthy = Boolean(leftExpression.value);
    if (expression.operator === "&&") {
      return hasNonEmptyNativeTitleExpression(
        leftValueIsTruthy ? expression.right : leftExpression,
        scopes,
      );
    }
    return hasNonEmptyNativeTitleExpression(
      leftValueIsTruthy ? leftExpression : expression.right,
      scopes,
    );
  }
  return true;
};

const hasNonEmptyNativeTitle = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!attribute?.value) return false;
  if (isNodeOfType(attribute.value, "Literal")) {
    return typeof attribute.value.value === "string" && attribute.value.value.trim().length > 0;
  }
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return hasNonEmptyNativeTitleExpression(attribute.value.expression, scopes);
  }
  return true;
};

const toAttributeMatchKey = (
  kind: "identifier" | "literal" | "template",
  value: string,
): string | null => {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? `${kind}:${trimmedValue}` : null;
};

const getLiteralAttributeMatchKey = (value: unknown): string | null => {
  if (typeof value === "string") return toAttributeMatchKey("literal", value);
  if (typeof value === "number") return toAttributeMatchKey("literal", String(value));
  return null;
};

const getExpressionPathKey = (rawExpression: EsTreeNode): string | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) return expression.name;
  if (isNodeOfType(expression, "MemberExpression")) {
    if (expression.computed) return null;
    const objectPath = getExpressionPathKey(expression.object as EsTreeNode);
    const property = expression.property as EsTreeNode;
    if (objectPath === null || !isNodeOfType(property, "Identifier")) return null;
    return `${objectPath}.${property.name}`;
  }
  return null;
};

// A structural key for a dynamic template like `bucket-name-${bucket.id}`:
// both the label's htmlFor and the control's id are authored from the
// same source text, so matching quasi chunks + expression paths proves
// the association without evaluating anything.
const getTemplateStructureMatchKey = (
  templateLiteral: EsTreeNodeOfType<"TemplateLiteral">,
): string | null => {
  const quasis = templateLiteral.quasis ?? [];
  const expressions = templateLiteral.expressions ?? [];
  const parts: string[] = [];
  for (const [quasiIndex, quasi] of quasis.entries()) {
    parts.push(quasi.value?.cooked ?? quasi.value?.raw ?? "");
    if (quasiIndex < expressions.length) {
      const expressionKey = getExpressionPathKey(expressions[quasiIndex] as EsTreeNode);
      if (expressionKey === null) return null;
      parts.push(`\u0000${expressionKey}\u0000`);
    }
  }
  return toAttributeMatchKey("template", parts.join(""));
};

const getExpressionMatchKeys = (rawExpression: EsTreeNode): ReadonlyArray<string> => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) {
    const literalKey = getLiteralAttributeMatchKey(expression.value);
    return literalKey === null ? [] : [literalKey];
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(expression);
    if (staticValue !== null) {
      const literalKey = toAttributeMatchKey("literal", staticValue);
      return literalKey === null ? [] : [literalKey];
    }
    const templateKey = getTemplateStructureMatchKey(expression);
    return templateKey === null ? [] : [templateKey];
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return [
      ...getExpressionMatchKeys(expression.consequent as EsTreeNode),
      ...getExpressionMatchKeys(expression.alternate as EsTreeNode),
    ];
  }
  const pathKey = getExpressionPathKey(expression);
  if (pathKey !== null) {
    const identifierKey = toAttributeMatchKey("identifier", pathKey);
    return identifierKey === null ? [] : [identifierKey];
  }
  return [];
};

const getAttributeMatchKeys = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined,
): ReadonlyArray<string> => {
  if (!attribute?.value) return [];
  const value = attribute.value;
  if (isNodeOfType(value, "Literal")) {
    const literalKey = getLiteralAttributeMatchKey(value.value);
    return literalKey === null ? [] : [literalKey];
  }
  if (!isNodeOfType(value, "JSXExpressionContainer")) return [];
  return getExpressionMatchKeys(value.expression as EsTreeNode);
};

interface CheckChildContext {
  depth: number;
  customAttributes: ReadonlyArray<string>;
  controlComponents: ReadonlyArray<string>;
  settings: Readonly<Record<string, unknown>> | undefined;
  iconComponentNames: ReadonlySet<string>;
  iconNamespaceNames: ReadonlySet<string>;
}

// Locally-defined icon components almost universally advertise
// themselves by name: `Icon`, `IconDesktop`, `ChevronDownIcon`.
const ICON_COMPONENT_NAME_PATTERN = /^Icon($|[A-Z0-9_])|Icon$/;

const isIconComponentName = (tagName: string, context: CheckChildContext): boolean => {
  if (context.iconComponentNames.has(tagName)) return true;
  if (ICON_COMPONENT_NAME_PATTERN.test(tagName)) return true;
  const namespaceEnd = tagName.indexOf(".");
  if (namespaceEnd === -1) return false;
  return context.iconNamespaceNames.has(tagName.slice(0, namespaceEnd));
};

// Whether an expression child can contribute an accessible name.
// Provably-empty renders (null/boolean literals, empty strings) and
// icon-only JSX (including `cond ? <ChevronDown/> : <ChevronRight/>`)
// don't; anything dynamic stays conservative.
const expressionProvidesLabel = (
  rawExpression: EsTreeNode,
  currentDepth: number,
  context: CheckChildContext,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "JSXEmptyExpression")) return false;
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "string") return expression.value.trim().length > 0;
    if (typeof expression.value === "number") return true;
    return false;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      expressionProvidesLabel(expression.consequent as EsTreeNode, currentDepth, context) ||
      expressionProvidesLabel(expression.alternate as EsTreeNode, currentDepth, context)
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    // Only the right side of `guard && <content/>` renders as content.
    return expressionProvidesLabel(expression.right as EsTreeNode, currentDepth, context);
  }
  if (isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment")) {
    return checkChildForLabel(expression, currentDepth, context);
  }
  return true;
};

const checkChildForLabel = (
  child: EsTreeNode,
  currentDepth: number,
  context: CheckChildContext,
): boolean => {
  if (currentDepth > context.depth) return false;
  if (isNodeOfType(child, "JSXExpressionContainer")) {
    return expressionProvidesLabel(child.expression as EsTreeNode, currentDepth, context);
  }
  if (isNodeOfType(child, "JSXText")) return child.value.trim().length > 0;
  if (isNodeOfType(child, "JSXFragment")) {
    return child.children.some((nestedChild) =>
      checkChildForLabel(nestedChild as EsTreeNode, currentDepth + 1, context),
    );
  }
  if (isNodeOfType(child, "JSXElement")) {
    if (
      hasLabellingProp(child.openingElement.attributes as EsTreeNode[], context.customAttributes)
    ) {
      return true;
    }
    if (child.children.length === 0) {
      const tagName = getElementType(child.openingElement, context.settings);
      if (
        isReactComponentName(tagName) &&
        !context.controlComponents.includes(tagName) &&
        !isIconComponentName(tagName, context)
      ) {
        return true;
      }
    }
    for (const nestedChild of child.children) {
      if (checkChildForLabel(nestedChild as EsTreeNode, currentDepth + 1, context)) return true;
    }
  }
  return false;
};

const hasAccessibleLabelText = (
  element: EsTreeNodeOfType<"JSXElement">,
  context: CheckChildContext,
): boolean => {
  if (
    hasLabellingProp(element.openingElement.attributes as EsTreeNode[], context.customAttributes)
  ) {
    return true;
  }
  return element.children.some((child) => checkChildForLabel(child as EsTreeNode, 1, context));
};

const isFunctionBoundary = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrowFunctionExpression") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "FunctionDeclaration");

const rendersLabelElement = (
  tagName: string,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (tagName === LABEL_ELEMENT || tagName === LABEL_COMPONENT_NAME) return true;
  const componentAttribute = hasJsxPropIgnoreCase(opening.attributes, POLYMORPHIC_COMPONENT_PROP);
  if (!componentAttribute) return false;
  return getJsxPropStringValue(componentAttribute) === LABEL_ELEMENT;
};

// One upward pass: the control needs no own label when an ancestor
// hides it from AT entirely, wraps it in a (text-bearing) label
// element, or is a field-wrapper component carrying the visible name
// in a `label` prop. Label association stops at the first function
// boundary (a render callback may mount anywhere), but hidden-ness
// keeps applying through children-position callbacks (`.map(...)`
// output renders in place); only a JSXAttribute boundary makes the
// render context unknowable.
const findAncestorNameSource = (
  element: EsTreeNodeOfType<"JSXElement">,
  context: CheckChildContext,
): "hidden" | "labeled" | null => {
  let current = element.parent;
  let didCrossFunctionBoundary = false;
  while (current) {
    if (isNodeOfType(current, "JSXAttribute")) break;
    if (isFunctionBoundary(current)) didCrossFunctionBoundary = true;
    if (isNodeOfType(current, "JSXElement")) {
      const opening = current.openingElement;
      if (isElementInlineHidden(opening, context.settings)) return "hidden";
      const tagName = getElementType(opening, context.settings);
      if (
        !didCrossFunctionBoundary &&
        rendersLabelElement(tagName, opening) &&
        hasAccessibleLabelText(current, context)
      ) {
        return "labeled";
      }
      // The wrapper-label-prop association survives function
      // boundaries: `<Field label="Body">{(id) => <textarea id={id}/>}
      // </Field>` is the render-prop flavour of the same injection.
      if (
        isReactComponentName(tagName) &&
        hasNonEmptyPropValue(hasJsxPropIgnoreCase(opening.attributes, WRAPPER_LABEL_PROP))
      ) {
        return "labeled";
      }
    }
    current = current.parent ?? null;
  }
  return null;
};

const isInsideJsxAttribute = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  let current = element.parent;
  while (current) {
    if (isNodeOfType(current, "JSXAttribute")) return true;
    current = current.parent ?? null;
  }
  return false;
};

// The name the element's render output is bound to: `renderField` in
// `const renderField = (field) => <input … />`, a `function
// renderField() {}`, or `checkbox` in `const checkbox = <input … />`.
// Used to associate the output with a `<label>…{renderField(field)}…
// </label>` / `<label>{checkbox}…</label>` embed site.
const getEnclosingBindingName = (element: EsTreeNodeOfType<"JSXElement">): string | null => {
  let current = element.parent;
  while (current) {
    if (isNodeOfType(current, "VariableDeclarator")) {
      return isNodeOfType(current.id as EsTreeNode, "Identifier")
        ? (current.id as EsTreeNodeOfType<"Identifier">).name
        : null;
    }
    if (isFunctionBoundary(current)) {
      if (
        isNodeOfType(current, "FunctionDeclaration") &&
        current.id &&
        isNodeOfType(current.id as EsTreeNode, "Identifier")
      ) {
        return current.id.name;
      }
      const functionParent = current.parent;
      if (
        functionParent &&
        isNodeOfType(functionParent, "VariableDeclarator") &&
        isNodeOfType(functionParent.id as EsTreeNode, "Identifier")
      ) {
        return (functionParent.id as EsTreeNodeOfType<"Identifier">).name;
      }
      return null;
    }
    current = current.parent ?? null;
  }
  return null;
};

const collectEmbeddedNamesFromExpression = (
  rawExpression: EsTreeNode,
  names: Set<string>,
): void => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    names.add(expression.name);
    return;
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee as EsTreeNode);
    if (isNodeOfType(callee, "Identifier")) names.add(callee.name);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    collectEmbeddedNamesFromExpression(expression.left as EsTreeNode, names);
    collectEmbeddedNamesFromExpression(expression.right as EsTreeNode, names);
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    collectEmbeddedNamesFromExpression(expression.consequent as EsTreeNode, names);
    collectEmbeddedNamesFromExpression(expression.alternate as EsTreeNode, names);
  }
};

const collectLabelEmbeddedNames = (
  element: EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment">,
  currentDepth: number,
  context: CheckChildContext,
  names: Set<string>,
): void => {
  if (currentDepth > context.depth) return;
  for (const child of element.children) {
    if (isNodeOfType(child as EsTreeNode, "JSXExpressionContainer")) {
      collectEmbeddedNamesFromExpression(
        (child as EsTreeNodeOfType<"JSXExpressionContainer">).expression as EsTreeNode,
        names,
      );
      continue;
    }
    if (
      isNodeOfType(child as EsTreeNode, "JSXElement") ||
      isNodeOfType(child as EsTreeNode, "JSXFragment")
    ) {
      collectLabelEmbeddedNames(
        child as EsTreeNodeOfType<"JSXElement">,
        currentDepth + 1,
        context,
        names,
      );
    }
  }
};

const supportsPlaceholderNameFallback = (
  tagName: string,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (tagName === "textarea") return true;
  if (tagName !== "input") return false;
  const typeAttribute = hasJsxPropIgnoreCase(opening.attributes, "type");
  if (!typeAttribute) return true;
  const typeValue = getJsxPropStringValue(typeAttribute);
  if (typeValue === null) return true;
  return PLACEHOLDER_NAMEABLE_INPUT_TYPES.has(typeValue.toLowerCase());
};

interface DeferredControlCandidate {
  opening: EsTreeNodeOfType<"JSXOpeningElement">;
  controlIdKeys: ReadonlyArray<string>;
  enclosingBindingName: string | null;
}

// Port of `oxc_linter::rules::jsx_a11y::control_has_associated_label`.
export const controlHasAssociatedLabel = defineRule({
  id: "control-has-associated-label",
  title: "Control missing accessible label",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Give every interactive control a label screen readers can read.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.filename);
    const iconComponentNames = new Set<string>();
    const iconNamespaceNames = new Set<string>();
    const labelHtmlForKeys = new Set<string>();
    const labelEmbeddedNames = new Set<string>();
    const deferredCandidates: DeferredControlCandidate[] = [];
    const checkContext: CheckChildContext = {
      depth: settings.depth,
      customAttributes: settings.labelAttributes,
      controlComponents: settings.controlComponents,
      settings: context.settings,
      iconComponentNames,
      iconNamespaceNames,
    };
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;
        if (typeof source !== "string" || !getIconLibraryFamily(source)) return;
        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier.local as EsTreeNode, "Identifier")) continue;
          const localName = (specifier.local as EsTreeNodeOfType<"Identifier">).name;
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            iconNamespaceNames.add(localName);
          } else {
            iconComponentNames.add(localName);
          }
        }
      },
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (isTestlikeFile) return;
        const opening = node.openingElement;
        const tagName = getElementType(opening, context.settings);

        // Labels anywhere in the file can associate (same-component
        // siblings, sibling components, render helpers) — collect them
        // all and decide at Program:exit. Labels inside JSX-attribute
        // callbacks (render props) may never render, so they don't
        // register.
        if (
          rendersLabelElement(tagName, opening) &&
          hasAccessibleLabelText(node, checkContext) &&
          !isInsideJsxAttribute(node)
        ) {
          const htmlForAttribute = hasJsxPropIgnoreCase(opening.attributes, HTML_FOR_ATTRIBUTE);
          for (const htmlForKey of getAttributeMatchKeys(htmlForAttribute)) {
            labelHtmlForKeys.add(htmlForKey);
          }
          if (tagName === LABEL_ELEMENT) {
            collectLabelEmbeddedNames(node, 1, checkContext, labelEmbeddedNames);
          }
        }

        if (DEFAULT_IGNORE_ELEMENTS.includes(tagName)) return;
        if (settings.ignoreElements.includes(tagName)) return;

        const roleAttribute = hasJsxPropIgnoreCase(opening.attributes, "role");
        const role = roleAttribute ? getJsxPropStringValue(roleAttribute) : null;
        if (role && settings.ignoreRoles.includes(role)) return;
        if (isElementInlineHidden(opening, context.settings)) return;
        if (isProgrammaticHiddenFileInput(tagName, opening)) return;

        const isDomElement = HTML_TAGS.has(tagName);
        const isInteractiveEl =
          !NON_OPERABLE_ELEMENTS.has(tagName) && isInteractiveElement(tagName, opening);
        const isNonFocusableSeparator =
          role === SEPARATOR_ROLE && !hasJsxPropIgnoreCase(opening.attributes, "tabIndex");
        const isInteractiveRoleEl =
          role !== null && isInteractiveRole(role) && !isNonFocusableSeparator;
        const isControlComponent = settings.controlComponents.includes(tagName);

        if (!(isInteractiveEl || (isDomElement && isInteractiveRoleEl) || isControlComponent)) {
          return;
        }

        if (tagName === "input") {
          const typeAttribute = hasJsxPropIgnoreCase(opening.attributes, "type");
          const typeValue = typeAttribute
            ? getJsxPropStringValue(typeAttribute)?.toLowerCase()
            : null;
          // Submit/reset inputs get a default accessible name from the
          // user agent; button inputs are named by `value` per HTML-AAM.
          if (typeValue === "submit" || typeValue === "reset") return;
          if (
            typeValue === "button" &&
            hasNonEmptyPropValue(hasJsxPropIgnoreCase(opening.attributes, "value"))
          ) {
            return;
          }
        }

        if (
          isDomElement &&
          hasNonEmptyNativeTitle(
            getLastJsxPropIgnoreCase(opening.attributes, TITLE_ATTRIBUTE),
            context.scopes,
          )
        ) {
          return;
        }

        if (
          supportsPlaceholderNameFallback(tagName, opening) &&
          hasNonEmptyPropValue(hasJsxPropIgnoreCase(opening.attributes, "placeholder"))
        ) {
          return;
        }

        if (hasLabellingProp(opening.attributes as EsTreeNode[], settings.labelAttributes)) {
          return;
        }
        // JSX passed as a prop value (`<Trans components={{ link: <a/> }}>`,
        // `icon={<button/>}`) is composed by the receiving component —
        // it may gain children/labels there, so its context is unknowable.
        if (isInsideJsxAttribute(node)) return;
        if (findAncestorNameSource(node, checkContext) !== null) return;
        // A select's accessible name never comes from its contents —
        // option text names the options, not the control.
        if (tagName !== SELECT_ELEMENT) {
          for (const child of node.children) {
            if (checkChildForLabel(child as EsTreeNode, 1, checkContext)) return;
          }
        }
        deferredCandidates.push({
          opening,
          controlIdKeys: getAttributeMatchKeys(
            hasJsxPropIgnoreCase(opening.attributes, ID_ATTRIBUTE),
          ),
          enclosingBindingName: getEnclosingBindingName(node),
        });
      },
      "Program:exit"() {
        for (const candidate of deferredCandidates) {
          if (candidate.controlIdKeys.some((idKey) => labelHtmlForKeys.has(idKey))) continue;
          if (
            candidate.enclosingBindingName !== null &&
            labelEmbeddedNames.has(candidate.enclosingBindingName)
          ) {
            continue;
          }
          context.report({ node: candidate.opening, message: MESSAGE });
        }
      },
    };
  },
});
