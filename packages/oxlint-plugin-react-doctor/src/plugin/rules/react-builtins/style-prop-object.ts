import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Your styles don't render because you passed the `style` prop a string instead of an object.";

interface StylePropObjectSettings {
  allow?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<StylePropObjectSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { stylePropObject?: StylePropObjectSettings }).stylePropObject ?? {})
      : {};
  return { allow: ruleSettings.allow ?? [] };
};

// `null` is a valid style value (clears the prop), as is `undefined`.
// Object literals, identifiers that resolve to objects/undefined, and
// expressions we can't statically analyze are all OK.
const isStaticallyInvalidStyleExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ObjectExpression")) return false;
  if (isNodeOfType(stripped, "Literal")) {
    if (stripped.value === null) return false;
    if (typeof stripped.value === "object") return false;
    return true; // string, number, boolean, regex
  }
  if (isNodeOfType(stripped, "TemplateLiteral")) return true;
  if (isNodeOfType(stripped, "Identifier") && stripped.name === "undefined") return false;
  return false;
};

const resolveIdentifierToInitializer = (expression: EsTreeNode): EsTreeNode | null => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return null;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return null;
  return binding.initializer;
};

// Maps a TS type-annotation node to one of "object" / "primitive" /
// "unknown" — drives style-prop validity for type-annotated bindings
// without an initializer (`let s: string`).
const classifyTsType = (typeNode: EsTreeNode): "object" | "primitive" | "unknown" => {
  if (
    typeNode.type === "TSStringKeyword" ||
    typeNode.type === "TSNumberKeyword" ||
    typeNode.type === "TSBooleanKeyword" ||
    typeNode.type === "TSBigIntKeyword" ||
    typeNode.type === "TSSymbolKeyword"
  ) {
    return "primitive";
  }
  if (
    typeNode.type === "TSObjectKeyword" ||
    typeNode.type === "TSTypeLiteral" ||
    typeNode.type === "TSTypeReference" ||
    typeNode.type === "TSArrayType" ||
    typeNode.type === "TSTupleType" ||
    typeNode.type === "TSFunctionType"
  ) {
    return "object";
  }
  if (typeNode.type === "TSNullKeyword" || typeNode.type === "TSUndefinedKeyword") {
    return "object"; // null/undefined are valid style values too
  }
  if (typeNode.type === "TSUnionType") {
    // Any member that's a primitive scalar (string/number/boolean) means
    // the style prop CAN hold an invalid value at runtime — flag the
    // whole union as primitive. `undefined` and `null` mixed in are
    // ignored since they're valid style values.
    let anyPrimitive = false;
    for (const member of (typeNode as { types: ReadonlyArray<EsTreeNode> }).types) {
      if (
        member.type === "TSUndefinedKeyword" ||
        member.type === "TSNullKeyword" ||
        member.type === "TSNeverKeyword"
      ) {
        continue;
      }
      const classified = classifyTsType(member);
      if (classified === "unknown") return "unknown";
      if (classified === "primitive") anyPrimitive = true;
      if (classified === "object") return "object";
    }
    return anyPrimitive ? "primitive" : "unknown";
  }
  return "unknown";
};

const findBindingTypeAnnotation = (expression: EsTreeNode): EsTreeNode | null => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return null;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding) return null;
  // The binding's identifier may carry `.typeAnnotation` (TSESTree).
  const typeAnnotationParent = (binding.bindingIdentifier as { typeAnnotation?: EsTreeNode | null })
    .typeAnnotation;
  if (!typeAnnotationParent || typeof typeAnnotationParent !== "object") return null;
  // TSTypeAnnotation has a nested .typeAnnotation containing the actual TS type.
  const inner = (typeAnnotationParent as { typeAnnotation?: EsTreeNode }).typeAnnotation;
  return inner ?? null;
};

const isInvalidStyleExpression = (expression: EsTreeNode): boolean => {
  if (isStaticallyInvalidStyleExpression(expression)) return true;
  // Resolve an identifier to its initializer and re-test once.
  const initializer = resolveIdentifierToInitializer(expression);
  if (initializer && isStaticallyInvalidStyleExpression(initializer)) return true;
  // No initializer? Try the TS type annotation on the binding.
  if (!initializer) {
    const typeAnnotation = findBindingTypeAnnotation(expression);
    if (typeAnnotation && classifyTsType(typeAnnotation) === "primitive") return true;
  }
  return false;
};

const getJsxOpeningElementName = (node: EsTreeNodeOfType<"JSXOpeningElement">): string | null => {
  if (isNodeOfType(node.name, "JSXIdentifier")) return node.name.name;
  return null;
};

// Port of `oxc_linter::rules::react::style_prop_object`. Reports `style`
// prop values that are clearly not objects: `style="..."` (string),
// `style={true}` / `style={42}` / `style={"x"}` etc. Also flags
// `React.createElement("div", { style: "..." })`. The `allow` setting
// list lets specific component names skip the check.
export const stylePropObject = defineRule<Rule>({
  id: "style-prop-object",
  title: "Style prop is not an object",
  severity: "warn",
  recommendation:
    "Pass `style` as an object so React can apply CSS properties instead of ignoring a string style value.",
  category: "Correctness",
  create: (context) => {
    const { allow } = resolveSettings(context.settings);
    const allowSet = new Set(allow);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementName = getJsxOpeningElementName(node);
        if (elementName && allowSet.has(elementName)) return;
        // Custom components define their own `style` prop type — many
        // libraries (Expo's `<StatusBar style="auto"/>`, React Native
        // chart libs, etc.) accept strings or enums. Only flag the
        // React-DOM-style contract on intrinsic HTML / SVG elements
        // (lowercase tag names) where the prop is React's reserved
        // CSS-properties object.
        if (elementName) {
          const firstCharCode = elementName.charCodeAt(0);
          const isIntrinsic = firstCharCode >= 97 && firstCharCode <= 122;
          if (!isIntrinsic) return;
        }
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          if (attribute.name.name !== "style") continue;
          const value = attribute.value;
          if (!value) continue;
          if (isNodeOfType(value, "Literal") && typeof value.value === "string") {
            context.report({ node: attribute, message: MESSAGE });
            return;
          }
          if (isNodeOfType(value, "JSXExpressionContainer")) {
            const innerExpression = value.expression;
            if (
              innerExpression &&
              innerExpression.type !== "JSXEmptyExpression" &&
              isInvalidStyleExpression(innerExpression as EsTreeNode)
            ) {
              context.report({ node: attribute, message: MESSAGE });
            }
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isCreateElementCall(node)) return;
        const firstArgument = node.arguments[0];
        if (!firstArgument) return;
        let elementName: string | null = null;
        if (isNodeOfType(firstArgument, "Literal") && typeof firstArgument.value === "string") {
          elementName = firstArgument.value;
        } else if (isNodeOfType(firstArgument, "Identifier")) {
          elementName = firstArgument.name;
        }
        if (elementName && allowSet.has(elementName)) return;

        const propsArgument = node.arguments[1];
        if (!propsArgument || !isNodeOfType(propsArgument, "ObjectExpression")) return;
        for (const property of propsArgument.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          // Skip computed-key properties (`[style]: true`) — OXC's port
          // doesn't flag these either since the key isn't statically the
          // string `"style"`.
          if (property.computed) continue;
          const key = property.key;
          const isStyleKey =
            (isNodeOfType(key, "Identifier") && key.name === "style") ||
            (isNodeOfType(key, "Literal") && key.value === "style");
          if (!isStyleKey) continue;
          if (isInvalidStyleExpression(property.value as EsTreeNode)) {
            context.report({ node: property, message: MESSAGE });
          }
        }
      },
    };
  },
});
