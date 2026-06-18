import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxKeyAttribute } from "../../utils/has-jsx-key-attribute.js";
import { isNonChildrenJsxAttributeValue } from "../../utils/is-non-children-jsx-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const ITERATOR_METHOD_NAMES = new Set(["map", "flatMap", "from"]);
const MISSING_KEY_ARRAY = "Your users can see the wrong data when this array reorders.";
const MISSING_KEY_ITERATOR = "Your users can see the wrong data when this list reorders.";
const KEY_BEFORE_SPREAD = "The `{...spread}` can overwrite this `key` & break React's tracking.";
const DUPLICATE_KEY = (keyValue: string): string =>
  `Your users can see the wrong data because two elements share the key "${keyValue}".`;

interface JsxKeySettings {
  checkKeyMustBeforeSpread?: boolean;
  warnOnDuplicates?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxKeySettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxKey?: JsxKeySettings }).jsxKey ?? {})
      : {};
  return {
    checkKeyMustBeforeSpread: ruleSettings.checkKeyMustBeforeSpread ?? true,
    warnOnDuplicates: ruleSettings.warnOnDuplicates ?? false,
  };
};

interface IteratorContextArray {
  kind: "array";
}
interface IteratorContextIterator {
  kind: "iterator";
  callExpression: EsTreeNode;
}
type IteratorContext = IteratorContextArray | IteratorContextIterator;

const findEnclosingIteratorContext = (jsxNode: EsTreeNode): IteratorContext | null => {
  let current: EsTreeNode | null | undefined = jsxNode;
  let isOutsideContainingFunction = false;
  let didSeeReturnStatement = false;

  while (current && current.parent) {
    const parent: EsTreeNode = current.parent;
    if (
      isNodeOfType(parent, "ArrowFunctionExpression") ||
      isNodeOfType(parent, "FunctionExpression") ||
      isNodeOfType(parent, "FunctionDeclaration")
    ) {
      // Arrow function with expression body counts as implicit return.
      if (isNodeOfType(parent, "ArrowFunctionExpression")) {
        const isExpressionBody = parent.body && parent.body.type !== "BlockStatement";
        if (!didSeeReturnStatement && !isExpressionBody) return null;
      } else if (!didSeeReturnStatement) {
        return null;
      }

      const grandparent = parent.parent;
      if (grandparent && isNodeOfType(grandparent, "Property")) return null;
      if (isOutsideContainingFunction) return null;
      isOutsideContainingFunction = true;
    } else if (isNodeOfType(parent, "ArrayExpression")) {
      if (isOutsideContainingFunction) return null;
      // Config arrays — `description: [<>...</>]`, `messages: [<Foo />]`,
      // `tooltip: [...]`, Map entry tuples `[[key, <X />], ...]` — aren't
      // iterated for rendering; they're data assigned to a property.
      // The array's elements get consumed as-is via `description[0]`,
      // `Map.get(key)`, etc. Reconciliation only cares about keys when
      // siblings render in a list; these aren't sibling renders.
      const arrayParent = parent.parent;
      if (arrayParent && isNodeOfType(arrayParent, "Property")) return null;
      // Tuple inside another array (e.g. `Map` entries:
      // `[[key, <Foo/>], [key, <Bar/>]]`) — the inner array is data,
      // outer array is what gets iterated.
      if (arrayParent && isNodeOfType(arrayParent, "ArrayExpression")) return null;
      // Element array handed to a non-`children` prop (`<Tabs items={[...]} />`).
      // React never key-validates props, so the receiving component owns keying.
      if (isNonChildrenJsxAttributeValue(parent)) return null;
      return { kind: "array" };
    } else if (isNodeOfType(parent, "CallExpression")) {
      const callee = parent.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return null;
      if (!isNodeOfType(callee.property, "Identifier")) return null;
      const methodName = callee.property.name;
      if (!ITERATOR_METHOD_NAMES.has(methodName)) return null;
      const targetArgIndex = methodName === "from" ? 1 : 0;
      const targetArg = parent.arguments[targetArgIndex];
      if (!targetArg) return null;
      // Confirm `current` is the function passed as the target arg, or
      // its descendant.
      let walker: EsTreeNode | null = current;
      while (walker && walker !== parent) {
        if (walker === targetArg) {
          // `<Menu items={xs.map(...)} />` — the mapped collection is a
          // non-`children` prop, so React never key-validates it.
          if (isNonChildrenJsxAttributeValue(parent)) return null;
          return { kind: "iterator", callExpression: parent };
        }
        walker = walker.parent ?? null;
      }
      return null;
    } else if (
      isNodeOfType(parent, "JSXElement") ||
      isNodeOfType(parent, "JSXOpeningElement") ||
      isNodeOfType(parent, "JSXFragment") ||
      isNodeOfType(parent, "Property")
    ) {
      return null;
    } else if (isNodeOfType(parent, "ReturnStatement")) {
      didSeeReturnStatement = true;
    }
    current = parent;
  }
  return null;
};

// Resolves the name of an iterator callback's first parameter — the "item"
// each element is built from. `xs.map((item) => ...)` → `"item"`. Only plain
// identifier params resolve; destructured params (`({ id }) => ...`) return
// null since there's no single binding to match a spread against.
const resolveIterationItemName = (callExpression: EsTreeNode): string | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const targetArgIndex = callee.property.name === "from" ? 1 : 0;
  const callback = callExpression.arguments[targetArgIndex];
  if (
    !callback ||
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression"))
  ) {
    return null;
  }
  const firstParam = callback.params[0];
  return firstParam && isNodeOfType(firstParam, "Identifier") ? firstParam.name : null;
};

// React never forwards `key` through `{...spread}`, so `xs.map(x => <X {...x} />)`
// is technically keyless. But spreading the *whole iteration item* is the
// canonical "the data row carries its own identity" shape — flagging it is the
// dominant source of jsx-key noise on real lists (every row spread fires) while
// rarely catching a genuine reorder bug. We treat that one shape as borderline
// and stay silent; genuine keyless lists (`<X name={x.name} />`, index keys,
// array literals) still report.
const spreadsIterationItem = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  iterationItemName: string,
): boolean => {
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXSpreadAttribute")) continue;
    const argument = attribute.argument;
    if (isNodeOfType(argument, "Identifier") && argument.name === iterationItemName) return true;
  }
  return false;
};

const isWithinChildrenToArray = (jsxNode: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = jsxNode.parent;
  while (current) {
    if (isNodeOfType(current, "CallExpression")) {
      const callee = current.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "toArray"
      ) {
        // Accept any of:
        //   - Children.toArray(...)        (named import)
        //   - <X>.Children.toArray(...)    (e.g. React.Children, Act.Children)
        const objectExpression = callee.object;
        if (isNodeOfType(objectExpression, "Identifier") && objectExpression.name === "Children") {
          return true;
        }
        if (
          isNodeOfType(objectExpression, "MemberExpression") &&
          isNodeOfType(objectExpression.property, "Identifier") &&
          objectExpression.property.name === "Children"
        ) {
          return true;
        }
      }
    }
    current = current.parent ?? null;
  }
  return false;
};

const checkKeyBeforeSpread = (
  context: Parameters<Rule["create"]>[0],
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): void => {
  // Track the FIRST spread we see; the diagnostic should fire whenever
  // any spread comes before the key, not just when ALL spreads do. Bug
  // caught by Bugbot: previously we recorded the LAST spread, so
  // `<App {...a} key="x" {...b} />` (key after `{...a}` but before
  // `{...b}`) was incorrectly silent.
  let keyIndex: number | null = null;
  let keyAttribute: EsTreeNode | null = null;
  let firstSpreadIndex: number | null = null;
  for (
    let attributeIndex = 0;
    attributeIndex < openingElement.attributes.length;
    attributeIndex++
  ) {
    const attribute = openingElement.attributes[attributeIndex];
    if (isNodeOfType(attribute, "JSXAttribute")) {
      if (isNodeOfType(attribute.name, "JSXIdentifier") && attribute.name.name === "key") {
        keyIndex = attributeIndex;
        keyAttribute = attribute;
      }
    } else if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      if (firstSpreadIndex === null) firstSpreadIndex = attributeIndex;
    }
  }
  if (
    keyIndex !== null &&
    firstSpreadIndex !== null &&
    keyIndex > firstSpreadIndex &&
    keyAttribute
  ) {
    context.report({ node: keyAttribute, message: KEY_BEFORE_SPREAD });
  }
};

const getKeyAttributeValueString = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): { keyValue: string; node: EsTreeNode } | null => {
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name, "JSXIdentifier") || attribute.name.name !== "key") continue;
    const value = attribute.value;
    if (!value) return null;
    if (isNodeOfType(value, "Literal")) {
      const literalValue = value.value;
      if (typeof literalValue === "string" || typeof literalValue === "number") {
        return { keyValue: String(literalValue), node: attribute };
      }
      return null;
    }
    if (isNodeOfType(value, "JSXExpressionContainer")) {
      const expression = value.expression;
      if (isNodeOfType(expression, "Literal")) {
        const literalValue = expression.value;
        if (typeof literalValue === "string" || typeof literalValue === "number") {
          return { keyValue: String(literalValue), node: attribute };
        }
        return null;
      }
      if (isNodeOfType(expression, "TemplateLiteral")) {
        const staticValue = getStaticTemplateLiteralValue(expression);
        if (staticValue !== null) return { keyValue: staticValue, node: attribute };
      }
    }
  }
  return null;
};

// Port of `oxc_linter::rules::react::jsx_key`. Reports JSX elements inside
// array literals or `.map` / `.flatMap` / `Array.from` callbacks that lack a
// `key` prop. Honors two settings:
//   - checkKeyMustBeforeSpread (default true): reports `<X {...p} key=…>`
//   - warnOnDuplicates (default false): duplicate `key` values among siblings
// Skips elements wrapped by `Children.toArray(...)` since React's runtime
// assigns synthetic keys for those.
export const jsxKey = defineRule({
  id: "jsx-key",
  title: "Missing key in list",
  severity: "error",
  recommendation:
    "Add a stable `key` prop so React can keep list items matched to the right data when the list changes.",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const openingElement = node.openingElement;
        if (settings.checkKeyMustBeforeSpread) {
          checkKeyBeforeSpread(context, openingElement);
        }
        if (settings.warnOnDuplicates) {
          // Duplicate keys among children of this element.
          const seenKeys = new Set<string>();
          for (const child of node.children) {
            if (!isNodeOfType(child, "JSXElement")) continue;
            const keyValue = getKeyAttributeValueString(child.openingElement);
            if (!keyValue) continue;
            if (seenKeys.has(keyValue.keyValue)) {
              context.report({ node: keyValue.node, message: DUPLICATE_KEY(keyValue.keyValue) });
            } else {
              seenKeys.add(keyValue.keyValue);
            }
          }
        }
        // Missing key check: only on top-level JSX in an array/iterator.
        const enclosingContext = findEnclosingIteratorContext(node);
        if (!enclosingContext) return;
        if (isWithinChildrenToArray(node)) return;
        if (hasJsxKeyAttribute(openingElement)) return;
        if (enclosingContext.kind === "iterator") {
          const iterationItemName = resolveIterationItemName(enclosingContext.callExpression);
          if (iterationItemName && spreadsIterationItem(openingElement, iterationItemName)) return;
        }
        context.report({
          node: openingElement,
          message: enclosingContext.kind === "array" ? MISSING_KEY_ARRAY : MISSING_KEY_ITERATOR,
        });
      },
      ArrayExpression(node: EsTreeNodeOfType<"ArrayExpression">) {
        if (!settings.warnOnDuplicates) return;
        const seenKeys = new Set<string>();
        for (const element of node.elements) {
          if (!element) continue;
          if (!isNodeOfType(element, "JSXElement")) continue;
          const keyValue = getKeyAttributeValueString(element.openingElement);
          if (!keyValue) continue;
          if (seenKeys.has(keyValue.keyValue)) {
            context.report({ node: keyValue.node, message: DUPLICATE_KEY(keyValue.keyValue) });
          } else {
            seenKeys.add(keyValue.keyValue);
          }
        }
      },
    };
  },
});
