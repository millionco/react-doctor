import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "Spreading props after defaults copies an explicit `undefined` over a default, and this merged value feeds a computation, so the component runs without the default it declared. Strip `undefined` keys before merging or apply the default at the use site (`props.width ?? defaults.width`).";

// Lowercase `default(s)Xxx` / SCREAMING `..._DEFAULT_PROPS` naming only —
// config-flavored names (`defaultGlobalConfig`, `currentConfig`) belong to
// imperative patch/setter merges where later-wins (including explicit
// `undefined`) is the intended API contract, so they never fire.
const LOWER_DEFAULTS_PREFIX_PATTERN = /^defaults?([A-Z_]|$)/;
const SCREAMING_DEFAULTS_PATTERN = /^([A-Z0-9]+_)*DEFAULTS?(_[A-Z0-9]+)*$/;
const CONFIG_FLAVORED_NAME_PATTERN = /config/i;

const isDefaultsSourceName = (name: string): boolean =>
  (LOWER_DEFAULTS_PREFIX_PATTERN.test(name) || SCREAMING_DEFAULTS_PATTERN.test(name)) &&
  !CONFIG_FLAVORED_NAME_PATTERN.test(name);

const firstSpreadIsDefaultsSource = (argument: EsTreeNode): boolean => {
  if (isNodeOfType(argument, "Identifier")) return isDefaultsSourceName(argument.name);
  if (
    isNodeOfType(argument, "MemberExpression") &&
    !argument.computed &&
    isNodeOfType(argument.property, "Identifier")
  ) {
    return argument.property.name === "defaultProps";
  }
  return false;
};

const spreadArgumentOf = (spread: EsTreeNode): EsTreeNode | null => {
  const argument = (spread as { argument?: EsTreeNode }).argument;
  return argument ?? null;
};

// The enclosing component/hook's own parameter binding for `name`: either a
// plain parameter identifier (`(props) =>`) or a rest binding inside a
// destructured parameter (`({ className, ...rest }) =>`). Local bindings that
// merely reuse the name (a filtered copy, an object literal, a shadow inside
// a callback) are not the caller's props and cannot carry the caller's
// explicit `undefined`.
const propsParameterBindingForName = (
  functionNode: EsTreeNode,
  name: string,
): EsTreeNode | null => {
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    return null;
  }
  for (const parameter of functionNode.params ?? []) {
    let pattern: EsTreeNode = parameter;
    if (isNodeOfType(pattern, "AssignmentPattern")) pattern = pattern.left;
    if (isNodeOfType(pattern, "Identifier") && pattern.name === name) return pattern;
    if (isNodeOfType(pattern, "ObjectPattern")) {
      for (const property of pattern.properties ?? []) {
        if (
          isNodeOfType(property, "RestElement") &&
          isNodeOfType(property.argument, "Identifier") &&
          property.argument.name === name
        ) {
          return property.argument;
        }
      }
    }
  }
  return null;
};

const typeAnnotationHasOptionalMember = (typeNode: EsTreeNode): boolean => {
  // A named type reference (`Props`) may declare optional members we can't see
  // across files, so treat it as possibly-optional. An inline object type is
  // fully visible: only flag when it actually has a `?` member.
  if (isNodeOfType(typeNode, "TSTypeReference")) return true;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) {
    return typeNode.members.some((member) => Boolean((member as { optional?: boolean }).optional));
  }
  return false;
};

const parameterCanCarryExplicitUndefined = (parameterBinding: EsTreeNode): boolean => {
  const annotationWrapper = (parameterBinding as { typeAnnotation?: EsTreeNode }).typeAnnotation;
  const annotatedType = annotationWrapper
    ? (annotationWrapper as { typeAnnotation?: EsTreeNode }).typeAnnotation
    : null;
  if (!annotatedType) return true;
  return typeAnnotationHasOptionalMember(annotatedType);
};

const isComputationalConsumer = (consumer: EsTreeNode, expression: EsTreeNode): boolean => {
  if (isNodeOfType(consumer, "BinaryExpression")) return true;
  if (isNodeOfType(consumer, "UnaryExpression")) {
    return consumer.operator === "-" || consumer.operator === "+" || consumer.operator === "~";
  }
  if (isNodeOfType(consumer, "CallExpression") || isNodeOfType(consumer, "NewExpression")) {
    return consumer.arguments.some((callArgument) => callArgument === expression);
  }
  return isNodeOfType(consumer, "TemplateLiteral");
};

// Climbs from a reference through member accesses (`merged.width`) to the
// expression the merge result feeds, then asks whether that consumer is a
// computation (arithmetic, comparison, call argument, template) where an
// `undefined` changes behavior. Pure JSX forwarding, returns, fallbacks
// (`merged.x ?? 1`), and object re-wraps stay quiet.
const referenceFlowsIntoComputation = (referenceIdentifier: EsTreeNode): boolean => {
  let current: EsTreeNode = referenceIdentifier;
  let consumer: EsTreeNode | null | undefined = current.parent;
  while (
    consumer &&
    ((isNodeOfType(consumer, "MemberExpression") && consumer.object === current) ||
      isNodeOfType(consumer, "ChainExpression") ||
      isNodeOfType(consumer, "TSNonNullExpression"))
  ) {
    current = consumer;
    consumer = consumer.parent;
  }
  return consumer ? isComputationalConsumer(consumer, current) : false;
};

const identifierIsValueReference = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.property === identifier &&
    !parent.computed
  ) {
    return false;
  }
  if (isNodeOfType(parent, "Property") && parent.key === identifier && !parent.computed) {
    return false;
  }
  return true;
};

const mergeResultFlowsIntoComputation = (
  objectExpression: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  const consumer = objectExpression.parent;
  if (!consumer) return false;
  if (isComputationalConsumer(consumer, objectExpression)) return true;
  if (!isNodeOfType(consumer, "VariableDeclarator") || consumer.init !== objectExpression) {
    return false;
  }
  const mergedBindingNames = new Set<string>();
  collectPatternNames(consumer.id as EsTreeNode, mergedBindingNames);
  if (mergedBindingNames.size === 0) return false;
  let didFindComputationalUse = false;
  walkAst(functionNode, (candidate: EsTreeNode) => {
    if (didFindComputationalUse) return false;
    if (candidate === consumer.id) return false;
    if (!isNodeOfType(candidate, "Identifier")) return;
    if (!mergedBindingNames.has(candidate.name)) return;
    if (!identifierIsValueReference(candidate)) return;
    if (referenceFlowsIntoComputation(candidate)) didFindComputationalUse = true;
  });
  return didFindComputationalUse;
};

// Flags `{ ...defaultProps, ...props }` (or `{ ...X.defaultProps, ...props }`)
// directly inside a React component/hook whose OWN props parameter — or the
// rest binding of its destructured parameter — is the last spread operand,
// and only when the merge result (or a key destructured from it) flows into
// a computation where an explicit `undefined` changes behavior. Config-patch
// setters, helpers co-located with components, local bindings that shadow the
// props name, pure JSX-forwarding merges, fully-required inline types, and
// test files stay quiet.
export const noSpreadPropsOverDefaultsClobbersWithUndefined = defineRule({
  id: "no-spread-props-over-defaults-clobbers-with-undefined",
  title: "Spread props over defaults can clobber with undefined",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "`{ ...defaults, ...props }` lets an explicit `undefined` on props overwrite a default, so a caller passing `prop={undefined}` breaks the computation that consumes the merge. Strip `undefined` keys before merging or apply the default at the use site (`props.x ?? defaults.x`).",
  create: (context: RuleContext) => ({
    ObjectExpression(node: EsTreeNodeOfType<"ObjectExpression">) {
      const spreads = node.properties.filter((property) =>
        isNodeOfType(property as EsTreeNode, "SpreadElement"),
      );
      if (spreads.length < 2) return;

      const firstSpreadArgument = spreadArgumentOf(spreads[0] as EsTreeNode);
      if (!firstSpreadArgument || !firstSpreadIsDefaultsSource(firstSpreadArgument)) return;

      const lastSpreadArgument = spreadArgumentOf(spreads[spreads.length - 1] as EsTreeNode);
      if (!lastSpreadArgument || !isNodeOfType(lastSpreadArgument, "Identifier")) return;

      const enclosingFunction = nearestEnclosingFunction(node as EsTreeNode);
      if (!enclosingFunction) return;
      if (!componentOrHookDisplayNameForFunction(enclosingFunction)) return;

      const parameterBinding = propsParameterBindingForName(
        enclosingFunction,
        lastSpreadArgument.name,
      );
      if (!parameterBinding) return;
      const resolvedBinding = findVariableInitializer(
        lastSpreadArgument as EsTreeNode,
        lastSpreadArgument.name,
      );
      if (resolvedBinding && resolvedBinding.bindingIdentifier !== parameterBinding) return;
      if (!parameterCanCarryExplicitUndefined(parameterBinding)) return;

      if (!mergeResultFlowsIntoComputation(node as EsTreeNode, enclosingFunction)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
