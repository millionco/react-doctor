import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenCalleeName } from "../../utils/flatten-callee-name.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactFunctionCall } from "../../utils/is-react-function-call.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (element: string, customHelp?: string): string =>
  customHelp
    ? `Your project blocks \`<${element}>\` here. ${customHelp}`
    : `Your project blocks \`<${element}>\` here.`;

interface ForbidElementsItem {
  element: string;
  message?: string;
}

interface ForbidElementsSettings {
  forbid?: ReadonlyArray<string | ForbidElementsItem>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Map<string, string | undefined> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { forbidElements?: ForbidElementsSettings }).forbidElements ?? {})
      : {};
  const map = new Map<string, string | undefined>();
  for (const item of ruleSettings.forbid ?? []) {
    if (typeof item === "string") map.set(item, undefined);
    else map.set(item.element, item.message);
  }
  return map;
};

// Member-chain flattening for JS expressions (e.g. `React.Fragment`,
// `Module.Component`) reuses the canonical `flattenCalleeName` helper.
const flattenMemberName = flattenCalleeName;

// Port of `oxc_linter::rules::react::forbid_elements`. Driven by a
// settings list — `forbid: ["button", { element: "Modal", message: "use
// Button" }, ...]`. Each item matches against the JSX element name or
// the first argument of `React.createElement(...)`.
export const forbidElements = defineRule<Rule>({
  id: "forbid-elements",
  title: "Forbidden element used",
  severity: "warn",
  recommendation:
    "List the element names you want to block in the `forbidElements.forbid` setting.",
  category: "Architecture",
  create: (context) => {
    const forbidMap = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (forbidMap.size === 0) return;
        const fullName = flattenJsxName(node.name);
        if (!fullName || !forbidMap.has(fullName)) return;
        context.report({
          node: node.name,
          message: buildMessage(fullName, forbidMap.get(fullName)),
        });
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (forbidMap.size === 0) return;
        // Only match `createElement(...)` (bare) or `React.createElement(...)`.
        // `NotReact.createElement('button')` and `document.createElement(...)`
        // are NOT React component creations.
        if (!isReactFunctionCall(node, "createElement")) return;
        const firstArgument = node.arguments[0];
        if (!firstArgument) return;

        // Match OXC's argument-shape filters:
        //   - StringLiteral: must look like a DOM tag — lowercase first
        //     char, no `.` segments.
        //   - Identifier: PascalCase OR leading-underscore (component-like).
        //   - StaticMemberExpression: any (`Module.Foo` style).
        // Other shapes (object literals, numbers, function expressions,
        // lowercase identifiers, "Modal" / "_thing" strings, "dotted.x"
        // strings) are skipped.
        let elementName: string | null = null;
        if (isNodeOfType(firstArgument, "Literal") && typeof firstArgument.value === "string") {
          const value = firstArgument.value;
          const firstChar = value.charCodeAt(0);
          const isLowercaseDomTag = firstChar >= 97 && firstChar <= 122 && !value.includes(".");
          if (isLowercaseDomTag) elementName = value;
        } else if (isNodeOfType(firstArgument, "Identifier")) {
          const firstChar = firstArgument.name.charCodeAt(0);
          const isPascalCase = firstChar >= 65 && firstChar <= 90;
          const isLeadingUnderscore = firstChar === 95 /* _ */;
          if (isPascalCase || isLeadingUnderscore) elementName = firstArgument.name;
        } else if (isNodeOfType(firstArgument, "MemberExpression")) {
          elementName = flattenMemberName(firstArgument);
        }
        if (!elementName || !forbidMap.has(elementName)) return;
        context.report({
          node: firstArgument,
          message: buildMessage(elementName, forbidMap.get(elementName)),
        });
      },
    };
  },
});
