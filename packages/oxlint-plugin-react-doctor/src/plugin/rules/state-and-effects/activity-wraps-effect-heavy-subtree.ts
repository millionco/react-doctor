import { defineRule } from "../../utils/define-rule.js";
import { EFFECT_HOOK_NAMES, UPPERCASE_PATTERN } from "../../constants/react.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: React 19.2's `<Activity mode="hidden">` preserves state for a
// subtree but cleans up its Effects. When the boundary becomes visible
// again, React recreates every Effect — subscriptions, observers,
// effect-driven setState chains. On dense screens (settings, profile
// editor, checkout) the visible cost is a "remount storm" on what
// looks like a free state-preservation primitive. This rule is the
// narrow v1: report an `<Activity>` with a TOGGLEABLE `mode` wrapping
// any same-file component that itself uses `useEffect` /
// `useLayoutEffect`. The user can then audit whether the inner
// effects belong outside the Activity boundary.

const ACTIVITY_IMPORTED_NAMES = new Set(["Activity", "unstable_Activity"]);

// A statically-known mode value (whether `"visible"`, `"hidden"`, or any
// other literal) means the boundary has no toggle — and therefore no
// hide/show cycle, no Effect teardown / recreate, no remount storm.
// Only flag toggleable shapes like `mode={open ? "visible" : "hidden"}`.
const isStaticallyKnownMode = (modeAttribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = modeAttribute.value;
  if (!value) return false;
  if (isNodeOfType(value, "Literal")) return true;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    return isNodeOfType(value.expression, "Literal");
  }
  return false;
};

const collectChildComponentNames = (
  element: EsTreeNodeOfType<"JSXElement">,
  into: Set<string>,
): void => {
  walkAst(element, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "JSXOpeningElement")) return;
    // Skip JSXMemberExpression children (`<Charts.Bar />`,
    // `<Foo.Bar.Baz />`). Member-expression children are by
    // definition not same-file references — they resolve through a
    // namespace / module. Extracting the trailing identifier and
    // looking up a same-file component of that name produces false
    // positives (e.g. `<Charts.Bar />` would collide with a same-file
    // `Bar` helper that has nothing to do with this boundary).
    if (!isNodeOfType(child.name, "JSXIdentifier")) return;
    const name = child.name.name;
    if (!UPPERCASE_PATTERN.test(name)) return;
    into.add(name);
  });
};

const findSameFileComponentBody = (
  programRoot: EsTreeNode,
  componentName: string,
): EsTreeNode | null => {
  let foundBody: EsTreeNode | null = null;
  walkAst(programRoot, (node: EsTreeNode) => {
    if (foundBody) return false;
    if (isNodeOfType(node, "FunctionDeclaration") && node.id && node.id.name === componentName) {
      foundBody = node.body;
      return false;
    }
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      node.id.name === componentName
    ) {
      const initializer = node.init;
      if (
        isNodeOfType(initializer, "ArrowFunctionExpression") ||
        isNodeOfType(initializer, "FunctionExpression")
      ) {
        foundBody = initializer.body;
        return false;
      }
    }
  });
  return foundBody;
};

const countEffectHookCalls = (body: EsTreeNode | null): number => {
  if (!body) return 0;
  let count = 0;
  walkAst(body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (isHookCall(child, EFFECT_HOOK_NAMES)) count++;
  });
  return count;
};

export const activityWrapsEffectHeavySubtree = defineRule<Rule>({
  id: "activity-wraps-effect-heavy-subtree",
  title: "Activity wraps an effect-heavy subtree",
  severity: "warn",
  // `<Activity>` shipped in React 19.2; gate on the minor-version
  // capability so the rule stays inert on 19.0 / 19.1 projects.
  requires: ["react:19.2"],
  recommendation:
    "Check what's under `<Activity>`. Every hide and show rebuilds every Effect inside from scratch. Move subscriptions and effect-driven setState out of the Activity, or load the data above it.",
  create: (context: RuleContext) => {
    const localActivityNames = new Set<string>();

    const reactNamespaceLocalNames = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (node.source?.value !== "react") return;
        for (const specifier of node.specifiers ?? []) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            // `import * as React from "react"` — bind the local name so
            // `<X.Activity>` can be verified against it.
            if (isNodeOfType(specifier.local, "Identifier")) {
              reactNamespaceLocalNames.add(specifier.local.name);
            }
            continue;
          }
          if (isNodeOfType(specifier, "ImportDefaultSpecifier")) {
            // `import React from "react"` — same shape, same handling.
            if (isNodeOfType(specifier.local, "Identifier")) {
              reactNamespaceLocalNames.add(specifier.local.name);
            }
            continue;
          }
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          const importedName = getImportedName(specifier);
          if (!importedName || !ACTIVITY_IMPORTED_NAMES.has(importedName)) continue;
          if (isNodeOfType(specifier.local, "Identifier")) {
            localActivityNames.add(specifier.local.name);
          }
        }
      },
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const openingElement = node.openingElement;
        if (!openingElement) return;
        const elementName = openingElement.name;
        let isActivity = false;
        if (isNodeOfType(elementName, "JSXIdentifier")) {
          isActivity = localActivityNames.has(elementName.name);
        } else if (isNodeOfType(elementName, "JSXMemberExpression")) {
          // `<React.Activity>` namespace form — verify the namespace
          // resolves to the React default / namespace import (not a
          // local `<Calendar.Activity>` user component).
          if (
            isNodeOfType(elementName.object, "JSXIdentifier") &&
            reactNamespaceLocalNames.has(elementName.object.name) &&
            isNodeOfType(elementName.property, "JSXIdentifier")
          ) {
            isActivity = ACTIVITY_IMPORTED_NAMES.has(elementName.property.name);
          }
        }
        if (!isActivity) return;

        let modeAttribute: EsTreeNodeOfType<"JSXAttribute"> | null = null;
        for (const attribute of openingElement.attributes ?? []) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          if (attribute.name.name !== "mode") continue;
          modeAttribute = attribute;
          break;
        }
        // No `mode` prop = default visible = always visible = no
        // hide/show cycle. Skip.
        if (!modeAttribute) return;
        // Any statically-known mode value (`"visible"`, `"hidden"`, ...) =
        // pinned, no toggle, no hide/show cycle. Only TOGGLEABLE modes
        // trigger the Effect teardown / recreate cost.
        if (isStaticallyKnownMode(modeAttribute)) return;

        const childComponentNames = new Set<string>();
        collectChildComponentNames(node, childComponentNames);
        // Drop the locally-bound Activity names so a nested
        // `<Activity>` inside another `<Activity>` doesn't self-report.
        // We DON'T drop the canonical `ACTIVITY_IMPORTED_NAMES`: the
        // namespace path already skips JSXMemberExpression in
        // `collectChildComponentNames`, and a same-file user component
        // legitimately named `Activity` (with effects, used as a child
        // inside an aliased boundary like `import { unstable_Activity as UA }`)
        // is a real positive we shouldn't silently drop.
        for (const activityName of localActivityNames) childComponentNames.delete(activityName);
        if (childComponentNames.size === 0) return;

        const programRoot = findProgramRoot(node);
        if (!programRoot) return;

        let totalEffects = 0;
        const effectfulChildren: string[] = [];
        for (const componentName of childComponentNames) {
          const body = findSameFileComponentBody(programRoot, componentName);
          if (!body) continue;
          const effectCount = countEffectHookCalls(body);
          if (effectCount === 0) continue;
          totalEffects += effectCount;
          effectfulChildren.push(`<${componentName}>`);
        }
        if (totalEffects === 0) return;

        context.report({
          node: openingElement,
          message: `Every hide and show rebuilds ${effectfulChildren.join(", ")} from scratch because <Activity> wraps components with ${totalEffects} effect hook${totalEffects === 1 ? "" : "s"}.`,
        });
      },
    };
  },
});
