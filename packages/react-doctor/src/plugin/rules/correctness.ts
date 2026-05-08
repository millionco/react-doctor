import { INDEX_PARAMETER_NAMES } from "../constants.js";
import {
  findJsxAttribute,
  isComponentAssignment,
  isHookCall,
  isUppercaseName,
  walkAst,
} from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const STRING_COERCION_FUNCTIONS = new Set(["String", "Number"]);

const isFunctionLikeExpression = (node: EsTreeNode): boolean =>
  node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";

const isFunctionBoundary = (node: EsTreeNode): boolean =>
  isFunctionLikeExpression(node) || node.type === "FunctionDeclaration";

const isMapCallback = (node: EsTreeNode): boolean =>
  isFunctionLikeExpression(node) &&
  node.parent?.type === "CallExpression" &&
  node.parent.callee?.type === "MemberExpression" &&
  node.parent.callee.property?.type === "Identifier" &&
  node.parent.callee.property.name === "map" &&
  node.parent.arguments?.[0] === node;

const findEnclosingMapCallback = (node: EsTreeNode): EsTreeNode | null => {
  let current = node.parent;
  while (current) {
    if (isFunctionBoundary(current)) return isMapCallback(current) ? current : null;
    current = current.parent;
  }
  return null;
};

const buildIndexParameterNames = (mapCallback: EsTreeNode | null): Set<string> => {
  const indexNames = new Set(INDEX_PARAMETER_NAMES);
  const indexParameter = mapCallback?.params?.[1];
  if (indexParameter?.type === "Identifier") indexNames.add(indexParameter.name);
  return indexNames;
};

const extractIndexName = (
  node: EsTreeNode | null | undefined,
  indexNames: Set<string> = INDEX_PARAMETER_NAMES,
): string | null => {
  if (!node) return null;
  if (node.type === "Identifier" && indexNames.has(node.name)) return node.name;

  if (node.type === "TemplateLiteral") {
    for (const expression of node.expressions ?? []) {
      const indexName = extractIndexName(expression, indexNames);
      if (indexName) return indexName;
    }
  }

  if (
    node.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    indexNames.has(node.callee.object.name) &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "toString"
  )
    return node.callee.object.name;

  if (
    node.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    STRING_COERCION_FUNCTIONS.has(node.callee.name) &&
    node.arguments?.[0]?.type === "Identifier" &&
    indexNames.has(node.arguments[0].name)
  )
    return node.arguments[0].name;

  if (node.type === "BinaryExpression" && node.operator === "+") {
    return extractIndexName(node.left, indexNames) ?? extractIndexName(node.right, indexNames);
  }

  return null;
};

const findTopLevelVariableInitializer = (
  mapCallback: EsTreeNode,
  variableName: string,
): EsTreeNode | null => {
  if (mapCallback.body?.type !== "BlockStatement") return null;
  for (const statement of mapCallback.body.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations ?? []) {
      if (declaration.id?.type === "Identifier" && declaration.id.name === variableName) {
        return declaration.init ?? null;
      }
    }
  }
  return null;
};

const extractIndexNameFromKeyExpression = (
  node: EsTreeNode,
  expression: EsTreeNode,
): string | null => {
  const mapCallback = findEnclosingMapCallback(node);
  const indexNames = buildIndexParameterNames(mapCallback);
  const directIndexName = extractIndexName(expression, indexNames);
  if (directIndexName) return directIndexName;
  if (!mapCallback || expression.type !== "Identifier") return null;
  return extractIndexName(
    findTopLevelVariableInitializer(mapCallback, expression.name),
    indexNames,
  );
};

const isInsideStaticPlaceholderMap = (node: EsTreeNode): boolean => {
  let current = node;
  while (current.parent) {
    current = current.parent;
    if (
      current.type === "CallExpression" &&
      current.callee?.type === "MemberExpression" &&
      current.callee.property?.name === "map"
    ) {
      const receiver = current.callee.object;
      if (receiver?.type === "CallExpression") {
        const callee = receiver.callee;
        if (
          callee?.type === "MemberExpression" &&
          callee.object?.type === "Identifier" &&
          callee.object.name === "Array" &&
          callee.property?.name === "from"
        )
          return true;
      }
      if (
        receiver?.type === "NewExpression" &&
        receiver.callee?.type === "Identifier" &&
        receiver.callee.name === "Array"
      )
        return true;
    }
  }
  return false;
};

export const noArrayIndexAsKey: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "key") return;
      if (!node.value || node.value.type !== "JSXExpressionContainer") return;

      const indexName = extractIndexNameFromKeyExpression(node, node.value.expression);
      if (!indexName) return;
      if (isInsideStaticPlaceholderMap(node)) return;

      context.report({
        node,
        message: `Array index "${indexName}" used as key — causes bugs when list is reordered or filtered`,
      });
    },
  }),
};

// HACK: <button> is intentionally omitted. <button type="submit"> (the
// HTML default inside a form) has a real default action, so calling
// preventDefault() on it is legitimate. The narrow case of
// <button type="button"> would need attribute inspection plus form-scope
// detection to be reliable; out of scope until we have evidence of real
// false-negatives.
// HACK: Map (not plain object) so a JSX tag named after an
// Object.prototype property (`<constructor>`, `<toString>`) doesn't
// fall through to a truthy `Object.prototype.X` value and crash on
// `targetEventProps.includes(...)` later in the rule body.
const PREVENT_DEFAULT_ELEMENTS = new Map<string, string[]>([
  ["form", ["onSubmit"]],
  ["a", ["onClick"]],
]);

const containsPreventDefaultCall = (node: EsTreeNode): boolean => {
  let didFindPreventDefault = false;
  walkAst(node, (child) => {
    if (didFindPreventDefault) return;
    if (
      child.type === "CallExpression" &&
      child.callee?.type === "MemberExpression" &&
      child.callee.property?.type === "Identifier" &&
      child.callee.property.name === "preventDefault"
    ) {
      didFindPreventDefault = true;
    }
  });
  return didFindPreventDefault;
};

const buildPreventDefaultMessage = (elementName: string): string => {
  if (elementName === "form") {
    return "preventDefault() on <form> onSubmit — form won't work without JavaScript. Consider using a server action for progressive enhancement";
  }
  return "preventDefault() on <a> onClick — use a <button> or routing component instead";
};

export const noPreventDefault: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const elementName = node.name?.type === "JSXIdentifier" ? node.name.name : null;
      if (!elementName) return;

      const targetEventProps = PREVENT_DEFAULT_ELEMENTS.get(elementName);
      if (!targetEventProps) return;

      for (const targetEventProp of targetEventProps) {
        const eventAttribute = findJsxAttribute(node.attributes ?? [], targetEventProp);
        if (!eventAttribute?.value || eventAttribute.value.type !== "JSXExpressionContainer")
          continue;

        const expression = eventAttribute.value.expression;
        if (
          expression?.type !== "ArrowFunctionExpression" &&
          expression?.type !== "FunctionExpression"
        )
          continue;

        if (!containsPreventDefaultCall(expression)) continue;

        context.report({ node, message: buildPreventDefaultMessage(elementName) });
        return;
      }
    },
  }),
};

const NUMERIC_NAME_HINTS = ["count", "length", "total", "size", "num"];

// HACK: word-boundary aware to avoid false positives like `discount` /
// `account` matching "count" or `strength` matching "length". The hint
// must be either the entire identifier OR appear at the end with a
// case/underscore boundary (`userCount`, `user_count`, `USER_COUNT`).
const isNumericName = (name: string): boolean => {
  for (const hint of NUMERIC_NAME_HINTS) {
    if (name === hint) return true;
    const camelSuffix = hint.charAt(0).toUpperCase() + hint.slice(1);
    if (name.endsWith(camelSuffix)) return true;
    if (name.endsWith(`_${hint}`)) return true;
    if (name.endsWith(`_${hint.toUpperCase()}`)) return true;
  }
  return false;
};

export const renderingConditionalRender: Rule = {
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNode) {
      if (node.operator !== "&&") return;

      const isRightJsx = node.right?.type === "JSXElement" || node.right?.type === "JSXFragment";
      if (!isRightJsx) return;

      const left = node.left;
      if (!left) return;

      const isLengthMemberAccess =
        left.type === "MemberExpression" &&
        left.property?.type === "Identifier" &&
        left.property.name === "length";

      const isNumericIdentifier = left.type === "Identifier" && isNumericName(left.name);

      if (isLengthMemberAccess || isNumericIdentifier) {
        context.report({
          node,
          message:
            "Conditional rendering with a numeric value can render '0' — use `value > 0`, `Boolean(value)`, or a ternary",
        });
      }
    },
  }),
};

// HACK: `typeof children === "string"` (or `=== 'object'`) is a
// polymorphic-children smell — the component switches behavior based on
// what the consumer happened to pass. Better to expose explicit
// subcomponents (`<Button.Text />`) so text always lands in the right
// shape and the component's API is checked at compile time.
export const noPolymorphicChildren: Rule = {
  create: (context: RuleContext) => ({
    BinaryExpression(node: EsTreeNode) {
      if (node.operator !== "===" && node.operator !== "==") return;

      const isTypeofChildren = (operand: EsTreeNode | undefined): boolean =>
        operand?.type === "UnaryExpression" &&
        operand.operator === "typeof" &&
        operand.argument?.type === "Identifier" &&
        operand.argument.name === "children";

      if (!isTypeofChildren(node.left) && !isTypeofChildren(node.right)) return;

      const isStringLiteral = (operand: EsTreeNode | undefined): boolean =>
        operand?.type === "Literal" && operand.value === "string";

      if (!isStringLiteral(node.left) && !isStringLiteral(node.right)) return;

      context.report({
        node,
        message:
          'Polymorphic `typeof children === "string"` check — expose explicit subcomponents (e.g. `<Button.Text>`) instead of branching on what the consumer passed',
      });
    },
  }),
};

const SVG_PATH_HIGH_PRECISION_PATTERN = /\d+\.\d{4,}/;
const SVG_PATH_ATTRIBUTES = new Set(["d", "points", "transform"]);

// HACK: SVG path strings with 4+ decimals (e.g. `M 10.293847 20.847362`)
// add bytes for sub-pixel precision the user can't see. Most editors
// emit these by default; truncating to 1–2 decimals trims 30–50% off
// markup with no visible difference.
export const renderingSvgPrecision: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier") return;
      if (!SVG_PATH_ATTRIBUTES.has(node.name.name)) return;
      if (node.value?.type !== "Literal") return;
      const value = node.value.value;
      if (typeof value !== "string") return;
      if (!SVG_PATH_HIGH_PRECISION_PATTERN.test(value)) return;

      context.report({
        node,
        message: `SVG ${node.name.name} attribute uses 4+ decimal precision — truncate to 1–2 decimals to shrink markup with no visible difference`,
      });
    },
  }),
};

const UNCONTROLLED_INPUT_TAGS = new Set(["input", "textarea", "select"]);

// HACK: <input type="checkbox"> / "radio" use the `checked` prop to be
// controlled; `value` is just the form-submission token. <input
// type="hidden"> never needs onChange — React's runtime warning skips
// it for the same reason. Limiting our `value`-needs-onChange check to
// non-hidden, non-checkable inputs keeps us aligned with React's own
// rules.
const VALUE_BYPASS_INPUT_TYPES = new Set(["hidden", "checkbox", "radio"]);

const VALUE_PARTNER_ATTRIBUTES = ["onChange", "readOnly"];

const getInputTypeLiteral = (attributes: EsTreeNode[]): string | null => {
  const typeAttribute = findJsxAttribute(attributes, "type");
  if (!typeAttribute || typeAttribute.value?.type !== "Literal") return null;
  const value = typeAttribute.value.value;
  return typeof value === "string" ? value : null;
};

const isUseStateUndefinedInitializer = (init: EsTreeNode | null | undefined): boolean => {
  if (!init || init.type !== "CallExpression") return false;
  if (!isHookCall(init, "useState")) return false;
  const args = init.arguments ?? [];
  if (args.length === 0) return true;
  const firstArgument = args[0];
  return firstArgument?.type === "Identifier" && firstArgument.name === "undefined";
};

const collectUndefinedInitialStateNames = (componentBody: EsTreeNode): Set<string> => {
  const stateNames = new Set<string>();
  if (componentBody?.type !== "BlockStatement") return stateNames;
  for (const statement of componentBody.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations ?? []) {
      if (declarator.id?.type !== "ArrayPattern") continue;
      const valueElement = declarator.id.elements?.[0];
      if (valueElement?.type !== "Identifier") continue;
      if (!isUseStateUndefinedInitializer(declarator.init)) continue;
      stateNames.add(valueElement.name);
    }
  }
  return stateNames;
};

const hasJsxSpreadAttribute = (attributes: EsTreeNode[]): boolean =>
  attributes.some((attribute) => attribute.type === "JSXSpreadAttribute");

// HACK: catches three uncontrolled-input mistakes that React's static
// rule set misses:
//   1. `value={...}` without `onChange` / `readOnly` — React renders
//      this as a silently read-only field at runtime.
//   2. `value` AND `defaultValue` set together — React ignores
//      defaultValue on a controlled input.
//   3. `value={state}` where `state` was initialized as undefined
//      (e.g. `useState()` with no argument) — the input starts
//      uncontrolled and flips to controlled on first set, which React
//      logs a runtime warning for.
//
// Bails when a spread attribute (`{...rest}`) is present — react-hook-form's
// `register()`, Headless UI, Radix, etc. routinely supply `onChange` /
// `defaultValue` via spread, and we can't see through it without scope
// analysis. False-negative > false-positive on a heavily used pattern.
export const noUncontrolledInput: Rule = {
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody) return;
      // Concise arrow bodies (`() => <input ... />`) skip the BlockStatement
      // wrapper; walk the JSX expression directly. There are no useState
      // declarations to collect for the undefined-initializer check, so an
      // empty set is correct.
      const undefinedInitialStateNames =
        componentBody.type === "BlockStatement"
          ? collectUndefinedInitialStateNames(componentBody)
          : new Set<string>();

      walkAst(componentBody, (child: EsTreeNode) => {
        if (child.type !== "JSXOpeningElement") return;
        if (child.name?.type !== "JSXIdentifier") return;
        const tagName = child.name.name;
        if (!UNCONTROLLED_INPUT_TAGS.has(tagName)) return;

        const attributes = child.attributes ?? [];
        if (hasJsxSpreadAttribute(attributes)) return;

        const valueAttribute = findJsxAttribute(attributes, "value");
        if (!valueAttribute) return;

        if (tagName === "input") {
          const inputType = getInputTypeLiteral(attributes);
          if (inputType !== null && VALUE_BYPASS_INPUT_TYPES.has(inputType)) return;
        }

        const hasAllowedPartner = VALUE_PARTNER_ATTRIBUTES.some((partnerAttributeName) =>
          findJsxAttribute(attributes, partnerAttributeName),
        );

        if (
          valueAttribute.value?.type === "JSXExpressionContainer" &&
          valueAttribute.value.expression?.type === "Identifier" &&
          undefinedInitialStateNames.has(valueAttribute.value.expression.name)
        ) {
          const stateName = valueAttribute.value.expression.name;
          const partnerHint = hasAllowedPartner
            ? "Initialize useState with an explicit value"
            : "Initialize useState with an explicit value AND add onChange (or readOnly)";
          context.report({
            node: child,
            message: `<${tagName} value={${stateName}}> — "${stateName}" is initialized as undefined (uncontrolled), then becomes controlled on first set; React warns about this flip. ${partnerHint} (e.g. \`useState("")\`)`,
          });
          return;
        }

        if (findJsxAttribute(attributes, "defaultValue")) {
          context.report({
            node: child,
            message: `<${tagName}> sets both \`value\` and \`defaultValue\` — defaultValue is ignored on a controlled input; remove one`,
          });
          return;
        }

        if (!hasAllowedPartner) {
          context.report({
            node: child,
            message: `<${tagName} value={...}> with no \`onChange\` or \`readOnly\` — React renders this as a silently read-only field`,
          });
        }
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        checkComponent(node.init?.body);
      },
    };
  },
};
