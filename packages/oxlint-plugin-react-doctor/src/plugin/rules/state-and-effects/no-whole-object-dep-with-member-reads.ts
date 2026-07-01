import { HOOKS_WITH_DEPS } from "../../constants/react.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

// The single name whose identity is a guaranteed-fresh reference every
// render: the whole props object bound to a `function C(props)` identifier
// parameter. React allocates a new props object each render, so a bare
// `props` dep whose body only reads members is reliably over-broad.
//
// We deliberately do NOT extend this to destructured names
// (`function C({ user }) {}`). A destructured `user` is `props.user` — its
// identity belongs to the *parent* and is typically stable, so `[user]`
// while reading `user.name` is idiomatic and exactly what React's own
// exhaustive-deps rule blesses. Flagging it would both contradict
// exhaustive-deps and assert a false "fresh object every render" premise, so
// scoping to the whole-props identifier keeps the detector sound.
const collectPropsObjectNames = (
  componentFunction: EsTreeNode
): Set<string> => {
  const propsNames = new Set<string>();
  if (!isFunctionLike(componentFunction)) return propsNames;
  const firstParam = componentFunction.params?.[0];
  if (!firstParam) return propsNames;
  if (isNodeOfType(firstParam, "Identifier")) {
    propsNames.add(firstParam.name);
  }
  return propsNames;
};

interface DependencyUsage {
  memberReadCount: number;
  hasBareUse: boolean;
}

// Classifies every reference to `dependencyName` inside the callback body:
// a "member read" is `X.prop` / `X["prop"]` (static), anything else — bare
// use, spread, argument, return, dynamic index — disqualifies the finding.
const analyzeDependencyUsage = (
  callbackBody: EsTreeNode,
  dependencyName: string
): DependencyUsage => {
  const usage: DependencyUsage = { memberReadCount: 0, hasBareUse: false };
  walkAst(callbackBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "Identifier") || child.name !== dependencyName)
      return;
    const parent = child.parent;
    if (parent && isNodeOfType(parent, "MemberExpression")) {
      // `something.X` — X is the property name of another object, not a use.
      if (parent.property === child && !parent.computed) return;
      if (parent.object === child) {
        const staticMember =
          !parent.computed ||
          (isNodeOfType(parent.property, "Literal") &&
            (typeof parent.property.value === "string" ||
              typeof parent.property.value === "number"));
        if (staticMember) {
          usage.memberReadCount += 1;
        } else {
          // `X[dynamicKey]` — dynamic index; treat as an unknown use.
          usage.hasBareUse = true;
        }
        return;
      }
    }
    // Non-shorthand object key `{ X: value }` is a key, not a use of X.
    if (
      parent &&
      isNodeOfType(parent, "Property") &&
      parent.key === child &&
      !parent.computed &&
      !parent.shorthand
    ) {
      return;
    }
    usage.hasBareUse = true;
  });
  return usage;
};

// Bindings the callback rebinds itself (its params) shadow the outer prop, so
// references inside no longer point at the component prop.
const callbackShadowsName = (
  callbackFunction: EsTreeNode,
  name: string
): boolean => {
  if (!isFunctionLike(callbackFunction)) return false;
  const shadowed = new Set<string>();
  for (const param of callbackFunction.params ?? [])
    collectPatternNames(param, shadowed);
  return shadowed.has(name);
};

export const noWholeObjectDepWithMemberReads = defineRule({
  id: "no-whole-object-dep-with-member-reads",
  title: "Whole props object in deps while only members are read",
  severity: "warn",
  recommendation:
    "Depend on the specific fields you read (e.g. `props.onChange`) instead of the whole `props` object. Props are a fresh object every render, so depending on the whole object re-runs the effect/memo every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, HOOKS_WITH_DEPS)) return;
      const args = node.arguments ?? [];
      if (args.length < 2) return;

      const callback = args[0];
      if (!isFunctionLike(callback)) return;
      const depsNode = stripParenExpression(args[1]);
      if (!isNodeOfType(depsNode, "ArrayExpression")) return;

      // The props object belongs to the enclosing component function; the
      // hook call sits directly in that component body.
      let componentFunction: EsTreeNode | null | undefined = node.parent;
      while (componentFunction && !isFunctionLike(componentFunction)) {
        componentFunction = componentFunction.parent;
      }
      if (!componentFunction) return;
      const displayName =
        componentOrHookDisplayNameForFunction(componentFunction);
      // Restrict to components — props semantics (fresh object per render)
      // only hold for a PascalCase component's first parameter.
      if (!displayName || !isUppercaseName(displayName)) return;

      const propsNames = collectPropsObjectNames(componentFunction);
      if (propsNames.size === 0) return;

      for (const element of depsNode.elements ?? []) {
        if (!element) continue;
        const dep = stripParenExpression(element);
        if (!isNodeOfType(dep, "Identifier")) continue;
        if (!propsNames.has(dep.name)) continue;
        if (callbackShadowsName(callback, dep.name)) continue;

        const usage = analyzeDependencyUsage(callback, dep.name);
        if (usage.hasBareUse || usage.memberReadCount === 0) continue;

        context.report({
          node: element,
          message: `This hook depends on the whole "${dep.name}" object but only reads its properties, so it re-runs every render because "${dep.name}" is a fresh object each time; depend on the specific fields you read instead.`,
        });
      }
    },
  }),
});
