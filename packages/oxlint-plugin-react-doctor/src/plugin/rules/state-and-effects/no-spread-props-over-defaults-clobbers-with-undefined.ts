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

const MAX_MERGE_DESTRUCTURE_DEPTH = 3;

const unwrapTsWrappers = (expression: EsTreeNode): EsTreeNode => {
  let current = expression;
  while (
    isNodeOfType(current, "TSAsExpression") ||
    isNodeOfType(current, "TSSatisfiesExpression") ||
    isNodeOfType(current, "TSNonNullExpression")
  ) {
    current = current.expression;
  }
  return current;
};

const staticPropertyKeyName = (property: EsTreeNodeOfType<"Property">): string | null => {
  if (!property.computed && isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

// The literal keys of the defaults object when its initializer is a visible
// object literal in this file. `null` means the key set is unknowable (an
// imported defaults object, an `X.defaultProps` member, a spread or computed
// key inside the literal) — every key is then treated as possibly defaulted.
const visibleDefaultedKeys = (defaultsSource: EsTreeNode): Set<string> | null => {
  if (!isNodeOfType(defaultsSource, "Identifier")) return null;
  const binding = findVariableInitializer(defaultsSource, defaultsSource.name);
  if (!binding?.initializer) return null;
  const initializer = unwrapTsWrappers(binding.initializer);
  if (!isNodeOfType(initializer, "ObjectExpression")) return null;
  const defaultedKeys = new Set<string>();
  for (const property of initializer.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const keyName = staticPropertyKeyName(property);
    if (!keyName) return null;
    defaultedKeys.add(keyName);
  }
  return defaultedKeys;
};

const isPossiblyDefaultedKey = (keyName: string, defaultedKeys: Set<string> | null): boolean =>
  defaultedKeys === null || defaultedKeys.has(keyName);

const staticMemberKeyName = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): string | null => {
  if (!memberExpression.computed && isNodeOfType(memberExpression.property, "Identifier")) {
    return memberExpression.property.name;
  }
  if (
    isNodeOfType(memberExpression.property, "Literal") &&
    typeof memberExpression.property.value === "string"
  ) {
    return memberExpression.property.value;
  }
  return null;
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

// `merged.<key>` (or `merged["key"]`) where <key> is possibly defaulted and
// the climbed consumer is a computation. Accessing a never-defaulted key
// cannot observe the clobber, so it stays quiet.
const memberAccessFeedsDefaultedKeyComputation = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
  defaultedKeys: Set<string> | null,
): boolean => {
  const keyName = staticMemberKeyName(memberExpression);
  if (!keyName || !isPossiblyDefaultedKey(keyName, defaultedKeys)) return false;
  return referenceFlowsIntoComputation(memberExpression);
};

const scalarBindingFeedsComputation = (
  bindingName: string,
  bindingPattern: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  let didFindComputationalUse = false;
  walkAst(functionNode, (candidate: EsTreeNode) => {
    if (didFindComputationalUse) return false;
    if (candidate === bindingPattern) return false;
    if (!isNodeOfType(candidate, "Identifier") || candidate.name !== bindingName) return;
    if (!identifierIsValueReference(candidate)) return;
    if (referenceFlowsIntoComputation(candidate)) didFindComputationalUse = true;
  });
  return didFindComputationalUse;
};

const objectBindingFeedsDefaultedKeyComputation = (
  bindingName: string,
  bindingPattern: EsTreeNode,
  defaultedKeys: Set<string> | null,
  functionNode: EsTreeNode,
  depth: number,
): boolean => {
  let didFindComputationalUse = false;
  walkAst(functionNode, (candidate: EsTreeNode) => {
    if (didFindComputationalUse) return false;
    if (candidate === bindingPattern) return false;
    if (!isNodeOfType(candidate, "Identifier") || candidate.name !== bindingName) return;
    if (!identifierIsValueReference(candidate)) return;
    if (
      objectReferenceFeedsDefaultedKeyComputation(candidate, defaultedKeys, functionNode, depth)
    ) {
      didFindComputationalUse = true;
    }
  });
  return didFindComputationalUse;
};

// A reference to the merged object only counts when a possibly-defaulted KEY
// flows onward — via a member access or a destructure of that key. The bare
// merged object handed whole to a call/new is NOT a computation: the callee
// may re-apply the defaults (basis `useResponsivePropsCSS(props, DEFAULT_PROPS,
// ...)`) or strip the defaulted keys (victory `Helpers.omit(props, [...])`).
const objectReferenceFeedsDefaultedKeyComputation = (
  referenceIdentifier: EsTreeNode,
  defaultedKeys: Set<string> | null,
  functionNode: EsTreeNode,
  depth: number,
): boolean => {
  const consumer = referenceIdentifier.parent;
  if (!consumer) return false;
  if (isNodeOfType(consumer, "MemberExpression") && consumer.object === referenceIdentifier) {
    return memberAccessFeedsDefaultedKeyComputation(consumer, defaultedKeys);
  }
  if (
    isNodeOfType(consumer, "VariableDeclarator") &&
    consumer.init === referenceIdentifier &&
    isNodeOfType(consumer.id, "ObjectPattern") &&
    depth < MAX_MERGE_DESTRUCTURE_DEPTH
  ) {
    return destructuredDefaultedKeysFeedComputation(
      consumer.id,
      defaultedKeys,
      functionNode,
      depth + 1,
    );
  }
  return false;
};

const destructuredDefaultedKeysFeedComputation = (
  pattern: EsTreeNodeOfType<"ObjectPattern">,
  defaultedKeys: Set<string> | null,
  functionNode: EsTreeNode,
  depth: number,
): boolean => {
  const namedKeys = new Set<string>();
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const keyName = staticPropertyKeyName(property);
    if (!keyName) continue;
    namedKeys.add(keyName);
    if (!isPossiblyDefaultedKey(keyName, defaultedKeys)) continue;
    const valuePattern = property.value;
    // `const { width = 100 } = merged` re-defaults at the destructure, so the
    // clobbered key is repaired before any use.
    if (isNodeOfType(valuePattern, "AssignmentPattern")) continue;
    if (isNodeOfType(valuePattern, "Identifier")) {
      if (scalarBindingFeedsComputation(valuePattern.name, pattern, functionNode)) return true;
      continue;
    }
    const nestedBindingNames = new Set<string>();
    collectPatternNames(valuePattern, nestedBindingNames);
    for (const nestedBindingName of nestedBindingNames) {
      if (scalarBindingFeedsComputation(nestedBindingName, pattern, functionNode)) return true;
    }
  }
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "RestElement")) continue;
    if (!isNodeOfType(property.argument, "Identifier")) continue;
    const restDefaultedKeys =
      defaultedKeys === null
        ? null
        : new Set(
            [...defaultedKeys].filter((defaultedKeyName) => !namedKeys.has(defaultedKeyName)),
          );
    if (restDefaultedKeys !== null && restDefaultedKeys.size === 0) continue;
    if (
      objectBindingFeedsDefaultedKeyComputation(
        property.argument.name,
        pattern,
        restDefaultedKeys,
        functionNode,
        depth,
      )
    ) {
      return true;
    }
  }
  return false;
};

const mergeResultFeedsDefaultedKeyComputation = (
  objectExpression: EsTreeNode,
  functionNode: EsTreeNode,
  defaultedKeys: Set<string> | null,
): boolean => {
  const consumer = objectExpression.parent;
  if (!consumer) return false;
  if (isNodeOfType(consumer, "MemberExpression") && consumer.object === objectExpression) {
    return memberAccessFeedsDefaultedKeyComputation(consumer, defaultedKeys);
  }
  if (!isNodeOfType(consumer, "VariableDeclarator") || consumer.init !== objectExpression) {
    return false;
  }
  if (isNodeOfType(consumer.id, "Identifier")) {
    return objectBindingFeedsDefaultedKeyComputation(
      consumer.id.name,
      consumer.id,
      defaultedKeys,
      functionNode,
      0,
    );
  }
  if (isNodeOfType(consumer.id, "ObjectPattern")) {
    return destructuredDefaultedKeysFeedComputation(consumer.id, defaultedKeys, functionNode, 1);
  }
  return false;
};

// Flags `{ ...defaultProps, ...props }` (or `{ ...X.defaultProps, ...props }`)
// directly inside a React component/hook whose OWN props parameter — or the
// rest binding of its destructured parameter — is the last spread operand,
// and only when a possibly-DEFAULTED key of the merge (a `merged.<key>`
// member access or a key destructured from it) flows into a computation where
// an explicit `undefined` changes behavior. When the defaults initializer is
// a visible object literal, only its keys qualify; when it is imported or
// otherwise opaque, any key does. The whole merged object handed to a call
// never qualifies — callees like `useResponsivePropsCSS(props, DEFAULT_PROPS)`
// or `omit(props, [...])` re-apply or strip the defaults. Config-patch
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

      const defaultedKeys = visibleDefaultedKeys(firstSpreadArgument);
      if (
        !mergeResultFeedsDefaultedKeyComputation(
          node as EsTreeNode,
          enclosingFunction,
          defaultedKeys,
        )
      ) {
        return;
      }

      context.report({ node, message: MESSAGE });
    },
  }),
});
