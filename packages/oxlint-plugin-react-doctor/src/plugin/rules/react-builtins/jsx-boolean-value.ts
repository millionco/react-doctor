import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const NEVER_MESSAGE = (): string =>
  "This boolean prop style disagrees with the project setting, so equivalent true props are harder to scan consistently.";
const ALWAYS_MESSAGE = (): string =>
  "This boolean prop style disagrees with the project setting, so equivalent true props are harder to scan consistently.";
const FALSE_OMITTED_MESSAGE = (attributeName: string): string =>
  `\`${attributeName}={false}\` does nothing, so the explicit false value adds noise without changing output.`;

interface JsxBooleanValueSettings {
  mode?: "never" | "always";
  always?: ReadonlyArray<string>;
  never?: ReadonlyArray<string>;
  assumeUndefinedIsFalse?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxBooleanValueSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxBooleanValue?: JsxBooleanValueSettings }).jsxBooleanValue ?? {})
      : {};
  return {
    mode: ruleSettings.mode ?? "never",
    always: ruleSettings.always ?? [],
    never: ruleSettings.never ?? [],
    assumeUndefinedIsFalse: ruleSettings.assumeUndefinedIsFalse ?? false,
  };
};

// Port of `oxc_linter::rules::react::jsx_boolean_value`. Two modes:
//   - "never" (default): `<C foo={true} />` should be `<C foo />`. With
//     `assumeUndefinedIsFalse: true`, also flags `<C foo={false} />`.
//     Per-attribute exceptions allowed via the `always` list.
//   - "always": `<C foo />` should be `<C foo={true} />`. Per-attribute
//     exceptions via the `never` list.
export const jsxBooleanValue = defineRule<Rule>({
  id: "jsx-boolean-value",
  title: "Inconsistent boolean prop notation",
  severity: "warn",
  // Pure stylistic rule — `attr={true}` vs `attr` is a formatter
  // concern, not a bug class. Default off.
  defaultEnabled: false,
  recommendation:
    "Use one boolean-attribute style so equivalent true props scan the same across the codebase.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const alwaysSet = new Set(settings.always);
    const neverSet = new Set(settings.never);

    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const attributeName = node.name.name;
        const value = node.value;
        const isShorthand = value === null || value === undefined;
        const isExpressionBooleanLiteral =
          value !== null &&
          isNodeOfType(value, "JSXExpressionContainer") &&
          isNodeOfType(value.expression, "Literal") &&
          typeof value.expression.value === "boolean";

        if (settings.mode === "never") {
          // shorthand should be allowed unless attribute is on always-list
          if (isShorthand && alwaysSet.has(attributeName)) {
            context.report({ node, message: ALWAYS_MESSAGE() });
            return;
          }
          if (
            !isExpressionBooleanLiteral ||
            !value ||
            !isNodeOfType(value, "JSXExpressionContainer")
          )
            return;
          const literalValue = (value.expression as EsTreeNodeOfType<"Literal">).value;
          if (literalValue === true && !alwaysSet.has(attributeName)) {
            context.report({ node, message: NEVER_MESSAGE() });
            return;
          }
          if (
            literalValue === false &&
            settings.assumeUndefinedIsFalse &&
            !alwaysSet.has(attributeName)
          ) {
            context.report({ node, message: FALSE_OMITTED_MESSAGE(attributeName) });
          }
          return;
        }

        // mode === "always"
        if (isShorthand && !neverSet.has(attributeName)) {
          context.report({ node, message: ALWAYS_MESSAGE() });
          return;
        }
        if (
          isExpressionBooleanLiteral &&
          neverSet.has(attributeName) &&
          value &&
          isNodeOfType(value, "JSXExpressionContainer") &&
          isNodeOfType(value.expression, "Literal")
        ) {
          const literalValue = value.expression.value;
          // Per-attr never-list says "omit value". Both `={true}` AND
          // `={false}` violate that. (When `assumeUndefinedIsFalse:
          // true`, `={false}` is also treated as undefined which means
          // "omit" — same conclusion.)
          if (literalValue === true || literalValue === false) {
            context.report({ node, message: NEVER_MESSAGE() });
          }
        }
      },
    };
  },
});
