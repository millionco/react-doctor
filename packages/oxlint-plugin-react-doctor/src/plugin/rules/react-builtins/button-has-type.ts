import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
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

// Wrapper components commonly re-expose the button type under a
// `…Type`-suffixed prop (`htmlType`, `buttonType`) because `type` is
// taken or ambiguous. Docs treat prop-forwarding wrappers as
// not-flagged; a renamed forward qualifies only when the prop NAME
// signals it carries the button type AND its destructuring default is a
// proven-valid literal, so the attribute can never be undefined at
// render. A generic prop (`kind = "button"`) stays flagged — the name
// carries no such contract (fp-review PR991).
const RENAMED_TYPE_PROP_NAME_PATTERN = /Type$/;

const bindsToRenamedTypePropWithValidDefault = (
  expression: EsTreeNodeOfType<"Identifier">,
  settings: Required<ButtonHasTypeSettings>,
): boolean => {
  if (!RENAMED_TYPE_PROP_NAME_PATTERN.test(expression.name)) return false;
  const binding = findVariableInitializer(expression, expression.name);
  const declaration = binding?.bindingIdentifier;
  const assignmentPattern = declaration?.parent;
  if (!assignmentPattern || !isNodeOfType(assignmentPattern, "AssignmentPattern")) return false;
  if (assignmentPattern.left !== declaration) return false;
  const property = assignmentPattern.parent;
  if (!property || !isNodeOfType(property, "Property") || property.computed) return false;
  if (property.value !== assignmentPattern) return false;
  if (!rootsAtFunctionParameter(property)) return false;
  return isProvenValidExpression(assignmentPattern.right, settings);
};

// `<button type={type}>` (or `<button type={props.type}>`) is a
// wrapper component forwarding the consumer's chosen type — the rule
// should fire at the CONSUMER's call site (where the literal value
// lives), not at the trampoline. Without this every styled-button
// wrapper that exposes `type` to its caller eats a diagnostic.
const isConsumerPropForward = (
  rawExpression: EsTreeNode,
  settings: Required<ButtonHasTypeSettings>,
  resolvedBindings: ReadonlySet<string> = new Set(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    if (expression.name === "type") return true;
    if (bindsToDestructuredTypeProp(expression)) return true;
    if (bindsToRenamedTypePropWithValidDefault(expression, settings)) return true;
    // A const bound to a GUARDED forward
    // (`const renderedType = disabled ? 'button' : type`) keeps the
    // forwarding shape one hop away — resolve and re-test. Only
    // conditional/logical initializers qualify: a bare alias
    // (`const button = type`) stays flagged, matching the upstream OXC
    // fail fixture.
    if (resolvedBindings.has(expression.name)) return false;
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding?.initializer || !isUnconditionalConstInitializer(binding)) return false;
    const initializer = stripParenExpression(binding.initializer);
    if (
      !isNodeOfType(initializer, "ConditionalExpression") &&
      !isNodeOfType(initializer, "LogicalExpression")
    ) {
      return false;
    }
    return isConsumerPropForward(
      initializer,
      settings,
      new Set(resolvedBindings).add(expression.name),
    );
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
    return isConsumerPropForward(expression.left as EsTreeNode, settings, resolvedBindings);
  }
  // `type={!!type ? type : 'button'}` — the ternary spelling of the
  // defaulted forward above: at least one branch forwards the consumer's
  // prop and every branch is either a forward or a proven-valid value.
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const branches = [expression.consequent, expression.alternate];
    const isBranchSafe = (branch: EsTreeNode): boolean =>
      isConsumerPropForward(branch, settings, resolvedBindings) ||
      isProvenValidExpression(branch, settings);
    return (
      branches.some((branch) => isConsumerPropForward(branch, settings, resolvedBindings)) &&
      branches.every(isBranchSafe)
    );
  }
  return false;
};

// react-aria interaction hooks return event-handler prop bags that never
// carry a `type` key, so spreading one onto a `<button>` cannot make the
// missing attribute appear at runtime.
const REACT_ARIA_MODULES = [
  "react-aria",
  "@react-aria/interactions",
  "@react-aria/focus",
  "@react-aria/utils",
];

const REACT_ARIA_HOOK_PROP_BAGS: Readonly<Record<string, string>> = {
  usePress: "pressProps",
  useLongPress: "longPressProps",
  useHover: "hoverProps",
  useFocus: "focusProps",
  useFocusRing: "focusProps",
  useFocusWithin: "focusWithinProps",
  useKeyboard: "keyboardProps",
  useMove: "moveProps",
};

const resolveReactAriaCanonicalName = (
  identifier: EsTreeNodeOfType<"Identifier">,
): string | null => {
  for (const moduleName of REACT_ARIA_MODULES) {
    const canonical = getImportedNameFromModule(identifier, identifier.name, moduleName);
    if (canonical !== null) return canonical;
  }
  return null;
};

const propertyKeyName = (property: EsTreeNodeOfType<"Property">): string | null => {
  if (property.computed) return null;
  if (isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

// Every return value of a same-file function whose destructured property
// `bagKeyName` is provably type-free (or absent) keeps the spread safe to
// report on. Nested functions' returns don't belong to `functionNode`.
const collectOwnReturnExpressions = (functionNode: EsTreeNode): EsTreeNode[] | null => {
  if (
    isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    functionNode.body &&
    functionNode.body.type !== "BlockStatement"
  ) {
    return [functionNode.body as EsTreeNode];
  }
  const returns: EsTreeNode[] = [];
  const visit = (node: EsTreeNode): boolean => {
    if (isNodeOfType(node, "ReturnStatement")) {
      if (!node.argument) return false;
      returns.push(node.argument as EsTreeNode);
      return true;
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      const children = Array.isArray(child) ? child : [child];
      for (const item of children) {
        if (!item || typeof item !== "object" || !("type" in item)) continue;
        const childNode = item as EsTreeNode;
        if (
          isNodeOfType(childNode, "FunctionDeclaration") ||
          isNodeOfType(childNode, "FunctionExpression") ||
          isNodeOfType(childNode, "ArrowFunctionExpression")
        ) {
          continue;
        }
        if (!visit(childNode)) return false;
      }
    }
    return true;
  };
  const body = (functionNode as { body?: EsTreeNode }).body;
  if (!body || !visit(body)) return null;
  return returns;
};

// `const { pressProps } = usePress(props)` — the bag identifier binds to a
// destructured property of a call result. Type-free when the call is a known
// react-aria interaction hook returning that bag, or a same-file function
// whose every return provides a type-free value under that key.
const destructuredCallBagCannotSupplyType = (
  binding: BindingInfo,
  visitedIdentifiers: ReadonlySet<string>,
): boolean => {
  const property = binding.bindingIdentifier.parent;
  if (!property || !isNodeOfType(property, "Property") || property.computed) return false;
  if (property.value !== binding.bindingIdentifier) return false;
  const bagKeyName = propertyKeyName(property);
  if (!bagKeyName) return false;
  const pattern = property.parent;
  if (!pattern || !isNodeOfType(pattern, "ObjectPattern")) return false;
  const declarator = pattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (declarator.id !== pattern || !declarator.init) return false;
  const declaration = declarator.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const"
  ) {
    return false;
  }
  const call = stripParenExpression(declarator.init as EsTreeNode);
  if (!isNodeOfType(call, "CallExpression")) return false;
  const callee = stripParenExpression(call.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const canonicalName = resolveReactAriaCanonicalName(callee);
  if (canonicalName !== null) return REACT_ARIA_HOOK_PROP_BAGS[canonicalName] === bagKeyName;
  const calleeBinding = findVariableInitializer(callee, callee.name);
  const localFunction = calleeBinding?.initializer;
  if (
    !localFunction ||
    (!isNodeOfType(localFunction, "FunctionDeclaration") &&
      !isNodeOfType(localFunction, "FunctionExpression") &&
      !isNodeOfType(localFunction, "ArrowFunctionExpression"))
  ) {
    return false;
  }
  const returnExpressions = collectOwnReturnExpressions(localFunction);
  if (!returnExpressions || returnExpressions.length === 0) return false;
  return returnExpressions.every((returned) => {
    const returnedObject = stripParenExpression(returned);
    if (!isNodeOfType(returnedObject, "ObjectExpression")) return false;
    for (const returnedProperty of returnedObject.properties) {
      if (isNodeOfType(returnedProperty, "SpreadElement")) return false;
      if (!isNodeOfType(returnedProperty, "Property")) return false;
      if (propertyKeyName(returnedProperty) === bagKeyName) {
        return spreadCannotSupplyType(returnedProperty.value as EsTreeNode, visitedIdentifiers);
      }
    }
    // The key is absent from the returned bag — destructuring yields
    // `undefined` and spreading `undefined` supplies nothing.
    return true;
  });
};

// True when a spread expression provably cannot carry a `type` key, so a
// `<button>` whose only hope for a `type` is that spread genuinely defaults
// to submit. Anything unresolvable stays "may supply → bail" (the FP-fix
// behavior for opaque props bags).
const spreadCannotSupplyType = (
  rawExpression: EsTreeNode,
  visitedIdentifiers: ReadonlySet<string> = new Set(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "ObjectExpression")) {
    return expression.properties.every((property) => {
      if (isNodeOfType(property, "SpreadElement")) {
        return spreadCannotSupplyType(property.argument as EsTreeNode, visitedIdentifiers);
      }
      if (!isNodeOfType(property, "Property")) return false;
      const keyName = propertyKeyName(property);
      return keyName !== null && keyName !== "type";
    });
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee as EsTreeNode);
    if (!isNodeOfType(callee, "Identifier")) return false;
    // `mergeProps(a, b)` merges its inputs — type-free iff every input is.
    if (resolveReactAriaCanonicalName(callee) !== "mergeProps") return false;
    return expression.arguments.every(
      (argument) =>
        !isNodeOfType(argument, "SpreadElement") &&
        spreadCannotSupplyType(argument as EsTreeNode, visitedIdentifiers),
    );
  }
  if (isNodeOfType(expression, "Identifier")) {
    if (visitedIdentifiers.has(expression.name)) return false;
    const nextVisited = new Set(visitedIdentifiers).add(expression.name);
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding) return false;
    if (binding.initializer && isUnconditionalConstInitializer(binding)) {
      return spreadCannotSupplyType(binding.initializer, nextVisited);
    }
    return destructuredCallBagCannotSupplyType(binding, nextVisited);
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
          // runtime, so the absence of an explicit attribute isn't proof —
          // unless every spread provably cannot carry a `type` key (e.g.
          // react-aria event-handler prop bags).
          if (hasJsxSpreadAttribute(node.attributes)) {
            const everySpreadIsTypeFree = node.attributes.every(
              (attribute) =>
                !isNodeOfType(attribute, "JSXSpreadAttribute") ||
                spreadCannotSupplyType(attribute.argument as EsTreeNode),
            );
            if (!everySpreadIsTypeFree) return;
          }
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
          if (isConsumerPropForward(expression as EsTreeNode, settings)) return;
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
          // `{ ...props }` may supply `type` at runtime, just like a JSX
          // spread — unless every spread provably cannot carry `type`.
          if (hasSpread) {
            const everySpreadIsTypeFree = propsArgument.properties.every(
              (property) =>
                !isNodeOfType(property, "SpreadElement") ||
                spreadCannotSupplyType(property.argument as EsTreeNode),
            );
            if (!everySpreadIsTypeFree) return;
          }
          context.report({ node: propsArgument, message: MISSING_MESSAGE });
          return;
        }
        // Mirror the JSX branch: consumer-forwarded `type` (`{ type: type }`
        // / `{ type: props.type }` / defaulted forwards) is a wrapper
        // re-exporting the prop, so the diagnostic should fire at the
        // caller's literal, not at the trampoline.
        if (isConsumerPropForward(typeProp, settings)) return;
        if (!isProvenValidExpression(typeProp, settings)) {
          reportInvalid(context, typeProp);
        }
      },
    };
  },
});
