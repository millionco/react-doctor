import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { Rule } from "../../utils/rule.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MISSING_MESSAGE =
  "Your users can submit the form by accident because a `<button>` with no `type` defaults to submit.";
const INVALID_MESSAGE =
  "This button has an invalid `type`, so the browser may treat it like a submit button.";

interface ButtonHasTypeSettings {
  button?: boolean;
  submit?: boolean;
  reset?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<ButtonHasTypeSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { buttonHasType?: ButtonHasTypeSettings }).buttonHasType ?? {})
      : {};
  return {
    button: ruleSettings.button ?? true,
    submit: ruleSettings.submit ?? true,
    reset: ruleSettings.reset ?? true,
  };
};

const isValidTypeValue = (rawValue: string, settings: Required<ButtonHasTypeSettings>): boolean => {
  if (rawValue === "button") return settings.button;
  if (rawValue === "submit") return settings.submit;
  if (rawValue === "reset") return settings.reset;
  return false;
};

// Returns true when the expression can be statically proven to always
// produce one of the allowed type values (so the rule should NOT fire).
// Anything that can't be proven valid — identifiers, dynamic template
// literals, mixed-branch conditionals — falls through to `false` which
// fires the diagnostic. This matches OXC's "if you can't show me a
// valid value, it's invalid" stance.
const isProvenValidExpression = (
  rawExpression: EsTreeNode,
  settings: Required<ButtonHasTypeSettings>,
  resolvedBindings: ReadonlySet<string> = new Set(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return isValidTypeValue(expression.value, settings);
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(expression);
    if (staticValue !== null) return isValidTypeValue(staticValue, settings);
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      isProvenValidExpression(expression.consequent, settings, resolvedBindings) &&
      isProvenValidExpression(expression.alternate, settings, resolvedBindings)
    );
  }
  // A bare identifier may name a local binding that resolves to a
  // provably valid literal (`const kind = "submit"; type={kind}`). Walk
  // to its initializer and re-test. `resolvedBindings` guards against a
  // cyclic chain. Only a direct `const` declarator init is proof — a
  // `let` can be reassigned before render, and a param DEFAULT
  // (`({ kind = "button" }) =>`) only applies when the caller omits the
  // arg, so both stay "unknown → invalid", as does an unresolvable
  // binding (prop / param / external).
  if (isNodeOfType(expression, "Identifier")) {
    if (resolvedBindings.has(expression.name)) return false;
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding?.initializer) return false;
    if (!isUnconditionalConstInitializer(binding)) return false;
    return isProvenValidExpression(
      binding.initializer,
      settings,
      new Set(resolvedBindings).add(expression.name),
    );
  }
  return false;
};

const isUnconditionalConstInitializer = (binding: BindingInfo): boolean => {
  const declarator = binding.bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (declarator.init !== binding.initializer) return false;
  const declaration = declarator.parent;
  return Boolean(
    declaration && isNodeOfType(declaration, "VariableDeclaration") && declaration.kind === "const",
  );
};

const DESTRUCTURING_PATTERN_TYPES = new Set<string>([
  "ObjectPattern",
  "ArrayPattern",
  "Property",
  "AssignmentPattern",
  "RestElement",
]);

const findDestructuringPatternRoot = (node: EsTreeNode): EsTreeNode => {
  let patternRoot = node;
  while (patternRoot.parent && DESTRUCTURING_PATTERN_TYPES.has(patternRoot.parent.type)) {
    patternRoot = patternRoot.parent;
  }
  return patternRoot;
};

// True when the destructuring pattern containing `bindingNode` roots at a
// function PARAMETER — directly (`({ type }) => …`) or through a local
// destructure of a param identifier (`const { type } = props`, where
// `props` is itself a param). A destructure of a local object literal or
// call result is NOT a consumer prop — the value lives right there.
const rootsAtFunctionParameter = (
  bindingNode: EsTreeNode,
  visitedBindingIdentifiers: Set<EsTreeNode> = new Set(),
): boolean => {
  if (visitedBindingIdentifiers.has(bindingNode)) return false;
  visitedBindingIdentifiers.add(bindingNode);
  const patternRoot = findDestructuringPatternRoot(bindingNode);
  const rootParent = patternRoot.parent;
  if (!rootParent) return false;
  if (
    rootParent.type === "FunctionDeclaration" ||
    rootParent.type === "FunctionExpression" ||
    rootParent.type === "ArrowFunctionExpression"
  ) {
    return rootParent.params.some((parameter) => parameter === patternRoot);
  }
  if (isNodeOfType(rootParent, "VariableDeclarator") && rootParent.id === patternRoot) {
    const initializer = rootParent.init;
    if (!initializer || !isNodeOfType(initializer, "Identifier")) return false;
    const sourceBinding = findVariableInitializer(initializer, initializer.name);
    if (!sourceBinding) return false;
    return rootsAtFunctionParameter(sourceBinding.bindingIdentifier, visitedBindingIdentifiers);
  }
  return false;
};

// True when the identifier binds to a destructured `type` prop, renamed
// or not (`({ type }) => …` / `({ type: kind }) => …`). The binding
// identifier's parent Property carries the original key `type`, so the
// real value still lives at the consumer's call site — but only when the
// pattern destructures a function parameter (props); a local destructure
// (`const { type: kind } = { type: "banana" }`) keeps the value in reach.
const bindsToDestructuredTypeProp = (expression: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(expression, expression.name);
  const declaration = binding?.bindingIdentifier;
  const property = declaration?.parent;
  if (!property || !isNodeOfType(property, "Property") || property.computed) return false;
  if (property.value !== declaration) return false;
  if (!rootsAtFunctionParameter(property)) return false;
  // The original key is `type`, whether written bare (`{ type: kind }`) or
  // quoted (`{ "type": kind }`).
  if (isNodeOfType(property.key, "Identifier")) return property.key.name === "type";
  if (isNodeOfType(property.key, "Literal")) return property.key.value === "type";
  return false;
};

// `<button type={type}>` (or `<button type={props.type}>`) is a
// wrapper component forwarding the consumer's chosen type — the rule
// should fire at the CONSUMER's call site (where the literal value
// lives), not at the trampoline. Without this every styled-button
// wrapper that exposes `type` to its caller eats a diagnostic.
const isConsumerPropForward = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Identifier")) {
    if (expression.name === "type") return true;
    return bindsToDestructuredTypeProp(expression);
  }
  if (
    isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    isNodeOfType(expression.property, "Identifier") &&
    expression.property.name === "type"
  ) {
    return true;
  }
  // `type={type ?? 'button'}` / `type={type || 'submit'}` — defaulted
  // forward where the fallback is itself valid.
  if (
    isNodeOfType(expression, "LogicalExpression") &&
    (expression.operator === "??" || expression.operator === "||")
  ) {
    return isConsumerPropForward(expression.left as EsTreeNode);
  }
  return false;
};

const reportInvalid = (context: Parameters<Rule["create"]>[0], reportNode: EsTreeNode): void => {
  context.report({ node: reportNode, message: INVALID_MESSAGE });
};

// Port of `oxc_linter::rules::react::button_has_type`. Flags
//   - `<button>` without a `type` attribute,
//   - `<button type="foo">` outside the allowed set,
//   - `React.createElement("button", { type: "foo" })` equivalents.
// Three settings (button/submit/reset, default true) toggle which
// values are allowed.
export const buttonHasType = defineRule({
  id: "button-has-type",
  title: "Button missing explicit type",
  severity: "warn",
  recommendation:
    'Set an explicit button `type` so plain buttons do not submit forms by accident: `type="button"`, `"submit"`, or `"reset"`.',
  create: (context) => {
    const settings = resolveSettings(context.settings);
    // Storybook stories and tests routinely render bare `<button>` without
    // a `type` attribute — the buttons aren't inside a real form so the
    // implicit `submit` behaviour is irrelevant. Skip these.
    const isTestlikeFile = isTestlikeFilename(context.filename);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "button") return;
        const typeAttr = hasJsxPropIgnoreCase(node.attributes, "type");
        if (!typeAttr) {
          // A spread (`<button {...props} />`) can forward `type` at
          // runtime, so the absence of an explicit attribute isn't proof.
          if (hasJsxSpreadAttribute(node.attributes)) return;
          context.report({ node: node.name, message: MISSING_MESSAGE });
          return;
        }
        const value = typeAttr.value;
        // Bare `<button type />` is shorthand for `type={true}` — not
        // any of the allowed string values.
        if (!value) {
          reportInvalid(context, typeAttr);
          return;
        }
        if (isNodeOfType(value, "Literal")) {
          if (!isProvenValidExpression(value, settings)) reportInvalid(context, typeAttr);
          return;
        }
        if (isNodeOfType(value, "JSXExpressionContainer")) {
          const expression = value.expression;
          if (!expression || expression.type === "JSXEmptyExpression") return;
          if (isConsumerPropForward(expression as EsTreeNode)) return;
          if (!isProvenValidExpression(expression as EsTreeNode, settings)) {
            reportInvalid(context, typeAttr);
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isTestlikeFile) return;
        if (!isCreateElementCall(node)) return;
        const firstArgument = node.arguments[0];
        if (
          !firstArgument ||
          !isNodeOfType(firstArgument, "Literal") ||
          firstArgument.value !== "button"
        ) {
          return;
        }
        const propsArgument = node.arguments[1];
        // No props (`createElement("button")`) or explicitly nullish props
        // (`…, null)`, `…, undefined)`, `…, void 0)`) carry no `type` — unlike
        // an opaque bag, which may forward one at runtime → missing.
        if (!propsArgument || isNullishExpression(propsArgument)) {
          context.report({ node, message: MISSING_MESSAGE });
          return;
        }
        // An opaque props bag (`createElement("button", props)`) may forward
        // `type` at runtime — mirror the JSX spread bailout, which doesn't
        // report a missing attribute it cannot see.
        if (!isNodeOfType(propsArgument, "ObjectExpression")) return;
        let typeProp: EsTreeNode | null = null;
        let hasSpread = false;
        for (const property of propsArgument.properties) {
          if (isNodeOfType(property, "SpreadElement")) {
            hasSpread = true;
            continue;
          }
          if (!isNodeOfType(property, "Property")) continue;
          const propertyKey = property.key;
          const matches =
            (isNodeOfType(propertyKey, "Identifier") && propertyKey.name === "type") ||
            (isNodeOfType(propertyKey, "Literal") && propertyKey.value === "type");
          if (matches) {
            typeProp = property.value;
            break;
          }
        }
        if (!typeProp) {
          // `{ ...props }` may supply `type` at runtime, just like a JSX spread.
          if (hasSpread) return;
          context.report({ node: propsArgument, message: MISSING_MESSAGE });
          return;
        }
        // Mirror the JSX branch: consumer-forwarded `type` (`{ type: type }`
        // / `{ type: props.type }` / defaulted forwards) is a wrapper
        // re-exporting the prop, so the diagnostic should fire at the
        // caller's literal, not at the trampoline.
        if (isConsumerPropForward(typeProp)) return;
        if (!isProvenValidExpression(typeProp, settings)) {
          reportInvalid(context, typeProp);
        }
      },
    };
  },
});
