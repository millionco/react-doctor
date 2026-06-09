import { compileGlob } from "../../utils/compile-glob.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildHandlerNameMessage = (handlerName: string, propKey: string): string =>
  `The handler "${handlerName}" does not match the "${propKey}" event prop convention, so readers cannot trace event flow quickly.`;
const buildHandlerPropMessage = (propKey: string, propValue: string): string =>
  `The prop "${propKey}" passes handler "${propValue}" but is not named like an event prop, so callers cannot tell it fires an event.`;

interface JsxHandlerNamesSettings {
  checkInlineFunction?: boolean;
  checkLocalVariables?: boolean;
  eventHandlerPrefix?: string | false;
  eventHandlerPropPrefix?: string | false;
  ignoreComponentNames?: ReadonlyArray<string>;
}

const DEFAULT_HANDLER_PREFIX = "handle";
const DEFAULT_HANDLER_PROP_PREFIX = "on";

interface ResolvedSettings {
  checkInlineFunction: boolean;
  checkLocalVariables: boolean;
  eventHandlerPrefix: string;
  eventHandlerPropPrefix: string;
  ignoreComponentNames: ReadonlyArray<string>;
  handlerRegex: RegExp | null;
  propRegex: RegExp | null;
}

const splitPrefixes = (prefixes: string): ReadonlyArray<string> =>
  prefixes
    .split("|")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const buildHandlerRegex = (handlerPrefix: string, handlerPropPrefix: string): RegExp | null => {
  if (handlerPrefix.length === 0 || handlerPropPrefix.length === 0) return null;
  const tokens = splitPrefixes(handlerPrefix);
  if (tokens.length === 0) return null;
  const escaped = tokens.map((token) => token.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^((.*\\.)?(${escaped}))[0-9]*[A-Z].*$`);
};

const buildPropRegex = (handlerPropPrefix: string): RegExp | null => {
  if (handlerPropPrefix.length === 0) return null;
  const tokens = splitPrefixes(handlerPropPrefix);
  if (tokens.length === 0) return null;
  const escaped = tokens.map((token) => token.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^(${escaped})[A-Z].*$`);
};

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): ResolvedSettings => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxHandlerNames?: JsxHandlerNamesSettings }).jsxHandlerNames ?? {})
      : {};
  let handlerPrefix = DEFAULT_HANDLER_PREFIX;
  let propPrefix = DEFAULT_HANDLER_PROP_PREFIX;
  if (ruleSettings.eventHandlerPrefix === false) handlerPrefix = "";
  else if (typeof ruleSettings.eventHandlerPrefix === "string") {
    handlerPrefix = ruleSettings.eventHandlerPrefix;
  }
  if (ruleSettings.eventHandlerPropPrefix === false) propPrefix = "";
  else if (typeof ruleSettings.eventHandlerPropPrefix === "string") {
    propPrefix = ruleSettings.eventHandlerPropPrefix;
  }
  return {
    checkInlineFunction: ruleSettings.checkInlineFunction ?? false,
    checkLocalVariables: ruleSettings.checkLocalVariables ?? false,
    eventHandlerPrefix: handlerPrefix,
    eventHandlerPropPrefix: propPrefix,
    ignoreComponentNames: ruleSettings.ignoreComponentNames ?? [],
    handlerRegex: buildHandlerRegex(handlerPrefix, propPrefix),
    propRegex: buildPropRegex(propPrefix),
  };
};

// Glob-match supporting `*` only.
// Mirrors OXC's `get_event_handler_name_from_static_member_expression`.
// is_props_handler is TRUE iff the chain is exactly:
//   - `props.<name>` (Identifier "props"), OR
//   - `this.props.<name>` (this.props with `.<name>` once)
// All deeper chains are FALSE.
const getHandlerNameFromMemberExpression = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): { name: string; isPropsHandler: boolean } | null => {
  if (!isNodeOfType(memberExpression.property, "Identifier")) return null;
  const lastName = memberExpression.property.name;
  const object = memberExpression.object as EsTreeNode;
  if (isNodeOfType(object, "Identifier")) {
    return { name: lastName, isPropsHandler: object.name === "props" };
  }
  if (isNodeOfType(object, "MemberExpression")) {
    if (
      isNodeOfType(object.object, "ThisExpression") &&
      isNodeOfType(object.property, "Identifier")
    ) {
      return { name: lastName, isPropsHandler: object.property.name === "props" };
    }
    return { name: lastName, isPropsHandler: false };
  }
  if (isNodeOfType(object, "ThisExpression")) {
    return { name: lastName, isPropsHandler: false };
  }
  return { name: lastName, isPropsHandler: false };
};

// Mirrors OXC's `get_event_handler_name_from_arrow_function`. Arrow
// must have an EXPRESSION body (not block), and its body must be a
// single CallExpression. Returns the call's handler name (callee).
const getHandlerNameFromArrowFunction = (
  arrowFunction: EsTreeNodeOfType<"ArrowFunctionExpression">,
): { name: string; isPropsHandler: boolean } | null => {
  const body = arrowFunction.body;
  // OXC rejects block-body arrows; ESTree marks `expression` field.
  if (isNodeOfType(body, "BlockStatement")) return null;
  if (!isNodeOfType(body, "CallExpression")) return null;
  const callee = body.callee;
  if (isNodeOfType(callee, "Identifier")) {
    return { name: callee.name, isPropsHandler: false };
  }
  if (isNodeOfType(callee, "MemberExpression")) {
    return getHandlerNameFromMemberExpression(callee);
  }
  return null;
};

// "Inline function" check (OXC's `is_member_expression_callee`): true
// iff the arrow's first statement is a CallExpression with a
// member-expression callee. Used to decide whether to walk deeper
// without `checkLocalVariables`. Handles both expression-body and
// block-body arrows.
const isMemberExpressionCallee = (
  arrowFunction: EsTreeNodeOfType<"ArrowFunctionExpression">,
): boolean => {
  const body = arrowFunction.body;
  let callExpression: EsTreeNodeOfType<"CallExpression"> | null = null;
  if (isNodeOfType(body, "CallExpression")) {
    callExpression = body;
  } else if (isNodeOfType(body, "BlockStatement")) {
    const first = body.body[0];
    if (
      first &&
      isNodeOfType(first as EsTreeNode, "ExpressionStatement") &&
      isNodeOfType(
        (first as EsTreeNodeOfType<"ExpressionStatement">).expression as EsTreeNode,
        "CallExpression",
      )
    ) {
      callExpression = (first as EsTreeNodeOfType<"ExpressionStatement">)
        .expression as EsTreeNodeOfType<"CallExpression">;
    }
  }
  return callExpression !== null && isNodeOfType(callExpression.callee, "MemberExpression");
};

// Port of `oxc_linter::rules::react::jsx_handler_names`.
export const jsxHandlerNames = defineRule<Rule>({
  id: "jsx-handler-names",
  title: "Inconsistent event handler names",
  severity: "warn",
  // Stylistic naming convention rule — the upstream pattern
  // (`onClick={handleClick}`) is widely-followed but not universal.
  // The rule also fires on solid-js `<Show when={props.onFoo}>` and
  // similar conditional-render APIs where the `on`-named prop value
  // isn't an event handler. Default off.
  defaultEnabled: false,
  recommendation:
    "Use the `on…` prefix for event-handler props and `handle…` for handlers so readers can trace event flow.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        // ignoreComponentNames check.
        if (settings.ignoreComponentNames.length > 0) {
          const opening = node.parent;
          if (!opening || !isNodeOfType(opening as EsTreeNode, "JSXOpeningElement")) return;
          const openingName = (opening as EsTreeNodeOfType<"JSXOpeningElement">).name;
          if (!isNodeOfType(openingName as EsTreeNode, "JSXIdentifier")) return;
          const componentName = (openingName as EsTreeNodeOfType<"JSXIdentifier">).name;
          for (const pattern of settings.ignoreComponentNames) {
            if (compileGlob(pattern).test(componentName)) return;
          }
        }

        const propName = getJsxAttributeName(node.name as EsTreeNode);
        if (!propName) return;
        if (propName === "ref") return;

        const value = node.value as EsTreeNode | null;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression as EsTreeNode;
        if (expression.type === "JSXEmptyExpression") return;

        // Determine handler name and whether it's a props-style chain.
        let handlerName: string | null = null;
        let isPropsHandler = false;
        if (isNodeOfType(expression, "MemberExpression")) {
          const result = getHandlerNameFromMemberExpression(expression);
          handlerName = result?.name ?? null;
          isPropsHandler = result?.isPropsHandler ?? false;
        } else if (isNodeOfType(expression, "Identifier")) {
          if (!settings.checkLocalVariables) return;
          handlerName = expression.name;
        } else if (isNodeOfType(expression, "ArrowFunctionExpression")) {
          if (!settings.checkInlineFunction) return;
          if (!settings.checkLocalVariables && !isMemberExpressionCallee(expression)) {
            return;
          }
          const result = getHandlerNameFromArrowFunction(expression);
          handlerName = result?.name ?? null;
          isPropsHandler = result?.isPropsHandler ?? false;
        } else {
          // Other expressions: fall back to literal source if we have it.
          if (!settings.checkLocalVariables) return;
          handlerName = "";
        }

        const propIsEventHandler = settings.propRegex ? settings.propRegex.test(propName) : null;
        let handlerNameIsCorrect: boolean | null;
        if (handlerName === null) {
          handlerNameIsCorrect = false;
        } else if (
          isPropsHandler &&
          settings.propRegex !== null &&
          settings.propRegex.test(handlerName)
        ) {
          handlerNameIsCorrect = true;
        } else if (settings.handlerRegex) {
          handlerNameIsCorrect = settings.handlerRegex.test(handlerName);
        } else {
          handlerNameIsCorrect = null;
        }

        if (propIsEventHandler === true && handlerNameIsCorrect === false) {
          context.report({
            node,
            message: buildHandlerNameMessage(handlerName ?? "", propName),
          });
          return;
        }
        if (propIsEventHandler === false && handlerNameIsCorrect === true) {
          context.report({
            node,
            message: buildHandlerPropMessage(propName, handlerName ?? ""),
          });
        }
      },
    };
  },
});
