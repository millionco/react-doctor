import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isDirectNamedReactHookCall } from "../../../utils/is-direct-named-react-hook-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { EffectStateWriteSite } from "./collect-effect-state-write-facts.js";
import { hasClosedFocusRefWiring, readDirectRefCurrent } from "./has-closed-focus-ref-wiring.js";
import { readStaticResetNumber } from "./read-static-reset-number.js";

const hasOwnedNativeFocusRef = (
  ref: SymbolDescriptor | null | undefined,
  acquisition: EsTreeNode,
  helper: EsTreeNode,
  context: RuleContext,
  directGuardRead?: EsTreeNode,
): boolean => {
  const initializer = ref?.initializer;
  const component = findEnclosingFunction(helper);
  return Boolean(
    ref?.kind === "const" &&
    isNodeOfType(initializer, "CallExpression") &&
    isDirectNamedReactHookCall(initializer, "useRef", context.scopes) &&
    initializer.arguments.length === 1 &&
    isNodeOfType(initializer.arguments[0], "Literal") &&
    initializer.arguments[0].value === null &&
    component &&
    hasClosedFocusRefWiring(ref, acquisition, component, context, directGuardRead),
  );
};

export const isClosedFocusBeforeLocalReset = (
  call: EsTreeNode,
  write: EffectStateWriteSite,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 0 ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    getStaticPropertyName(call.callee) !== "focus" ||
    !write.value ||
    readStaticResetNumber(write.value, context.scopes) === null
  ) {
    return false;
  }
  const focus = call.parent;
  const block = focus?.parent;
  const branch = block?.parent;
  const body = branch?.parent;
  const helper = body?.parent;
  const wrapper = helper?.parent;
  if (
    !isNodeOfType(focus, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement") ||
    block.body.length !== 2 ||
    block.body[0] !== focus ||
    block.body[1] !== write.node.parent ||
    !isNodeOfType(write.node.parent, "ExpressionStatement") ||
    !isNodeOfType(branch, "IfStatement") ||
    branch.consequent !== block ||
    branch.alternate ||
    !isNodeOfType(body, "BlockStatement") ||
    !isNodeOfType(helper, "ArrowFunctionExpression") ||
    helper.async ||
    helper.params.length !== 0 ||
    !isNodeOfType(wrapper, "CallExpression") ||
    wrapper.arguments[0] !== helper ||
    !isDirectNamedReactHookCall(wrapper, "useCallback", context.scopes)
  ) {
    return false;
  }
  if (body.body.length === 1 && body.body[0] === branch) {
    const acquisition = call.callee.object;
    const ref = readDirectRefCurrent(acquisition, context.scopes);
    return (
      ref !== null &&
      readDirectRefCurrent(branch.test, context.scopes) === ref &&
      hasOwnedNativeFocusRef(ref, acquisition, helper, context, branch.test)
    );
  }
  if (
    body.body.length !== 2 ||
    body.body[1] !== branch ||
    !isNodeOfType(branch.test, "Identifier") ||
    !isNodeOfType(call.callee.object, "Identifier")
  ) {
    return false;
  }
  const [local] = body.body;
  if (
    !isNodeOfType(local, "VariableDeclaration") ||
    local.kind !== "const" ||
    local.declarations.length !== 1
  ) {
    return false;
  }
  const [alias] = local.declarations;
  const acquisition = alias.init;
  if (
    !isNodeOfType(alias.id, "Identifier") ||
    !isNodeOfType(acquisition, "MemberExpression") ||
    acquisition.computed ||
    acquisition.optional ||
    getStaticPropertyName(acquisition) !== "current" ||
    !isNodeOfType(acquisition.object, "Identifier")
  ) {
    return false;
  }
  const input = context.scopes.symbolFor(alias.id);
  const ref = context.scopes.symbolFor(acquisition.object);
  return Boolean(
    input &&
    context.scopes.symbolFor(call.callee.object) === input &&
    context.scopes.symbolFor(branch.test) === input &&
    hasOwnedNativeFocusRef(ref, acquisition, helper, context),
  );
};
