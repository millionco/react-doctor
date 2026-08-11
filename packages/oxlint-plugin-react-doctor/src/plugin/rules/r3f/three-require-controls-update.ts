import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

interface UpdateDependentControlsConstruction {
  bindingIdentifier: EsTreeNodeOfType<"Identifier">;
  key: string;
  node: EsTreeNodeOfType<"NewExpression">;
  owner: EsTreeNode;
}

interface ControlsAnimationCallback {
  callback: EsTreeNode;
  owner: EsTreeNode;
}

const UPDATE_DEPENDENT_CONTROL_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "MapControls",
  "OrbitControls",
]);
const UPDATE_DEPENDENT_CONTROL_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "autoRotate",
  "enableDamping",
]);

const isControlsModuleSource = (moduleSource: string): boolean =>
  moduleSource === "three-stdlib" ||
  moduleSource.startsWith("three/addons/controls/") ||
  moduleSource.startsWith("three/examples/jsm/controls/");

const controlsEscapeOwner = (
  construction: UpdateDependentControlsConstruction,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(construction.bindingIdentifier);
  if (!symbol) return true;
  return symbol.references.some((reference) => {
    const parent = reference.identifier.parent;
    return !isNodeOfType(parent, "MemberExpression") || parent.object !== reference.identifier;
  });
};

const callbackUpdatesControls = (
  callback: EsTreeNode,
  controlsKey: string,
  context: RuleContext,
): boolean => {
  let updatesControls = false;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (
      updatesControls ||
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      getStaticPropertyName(candidate.callee) !== "update"
    ) {
      return;
    }
    if (resolveExpressionKey(candidate.callee.object, context) === controlsKey) {
      updatesControls = true;
    }
  });
  return updatesControls;
};

export const threeRequireControlsUpdate = defineRule({
  id: "three-require-controls-update",
  title: "Three.js controls require per-frame updates",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Call controls.update in the animation loop when OrbitControls or MapControls enables damping or auto-rotation",
  create: (context: RuleContext) => {
    const animationCallbacks: ControlsAnimationCallback[] = [];
    const constructions: UpdateDependentControlsConstruction[] = [];
    const updateDependentControlsKeys = new Set<string>();
    let program: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (!program) return;
        const provenance = getApiReferenceProvenance(node.callee, context.scopes);
        if (
          !provenance ||
          !UPDATE_DEPENDENT_CONTROL_CONSTRUCTOR_NAMES.has(provenance.apiName) ||
          !isControlsModuleSource(provenance.moduleSource)
        ) {
          return;
        }
        const declarator = node.parent;
        if (
          !isNodeOfType(declarator, "VariableDeclarator") ||
          declarator.init !== node ||
          !isNodeOfType(declarator.id, "Identifier")
        ) {
          return;
        }
        const key = resolveExpressionKey(declarator.id, context);
        const symbol = context.scopes.symbolFor(declarator.id);
        if (!key || symbol?.kind !== "const") return;
        constructions.push({
          bindingIdentifier: declarator.id,
          key,
          node,
          owner: findEnclosingFunction(node) ?? program,
        });
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (
          node.operator !== "=" ||
          !isNodeOfType(node.left, "MemberExpression") ||
          !UPDATE_DEPENDENT_CONTROL_PROPERTY_NAMES.has(getStaticPropertyName(node.left) ?? "") ||
          readStaticBoolean(node.right) !== true
        ) {
          return;
        }
        const controlsKey = resolveExpressionKey(node.left.object, context);
        if (controlsKey) updateDependentControlsKeys.add(controlsKey);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!program) return;
        const callback =
          resolveThreeAnimationLoopCallback(node, context.scopes) ??
          resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback) return;
        if (animationCallbacks.some((fact) => fact.callback === callback)) return;
        animationCallbacks.push({ callback, owner: findEnclosingFunction(node) ?? program });
      },
      "Program:exit"() {
        for (const construction of constructions) {
          if (
            !updateDependentControlsKeys.has(construction.key) ||
            controlsEscapeOwner(construction, context)
          ) {
            continue;
          }
          const ownerCallbacks = animationCallbacks.filter(
            (fact) => fact.owner === construction.owner,
          );
          if (
            ownerCallbacks.length === 0 ||
            ownerCallbacks.some((fact) =>
              callbackUpdatesControls(fact.callback, construction.key, context),
            )
          ) {
            continue;
          }
          context.report({
            node: construction.node,
            message:
              "These controls enable damping or auto-rotation, but no animation callback owned by the same setup calls controls.update",
          });
        }
      },
    };
  },
});
