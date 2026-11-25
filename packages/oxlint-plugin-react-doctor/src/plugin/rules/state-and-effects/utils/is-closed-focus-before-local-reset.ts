import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isDirectNamedReactHookCall } from "../../../utils/is-direct-named-react-hook-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { EffectStateWriteSite } from "./collect-effect-state-write-facts.js";
import { hasClosedFocusRefWiring } from "./has-closed-focus-ref-wiring.js";
import { readStaticResetNumber } from "./read-static-reset-number.js";

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
    !isNodeOfType(call.callee.object, "Identifier") ||
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
    !isNodeOfType(branch.test, "Identifier") ||
    !isNodeOfType(body, "BlockStatement") ||
    body.body.length !== 2 ||
    body.body[1] !== branch ||
    !isNodeOfType(helper, "ArrowFunctionExpression") ||
    helper.async ||
    helper.params.length !== 0 ||
    !isNodeOfType(wrapper, "CallExpression") ||
    wrapper.arguments[0] !== helper ||
    !isDirectNamedReactHookCall(wrapper, "useCallback", context.scopes)
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
  const initializer = ref?.initializer;
  const component = findEnclosingFunction(helper);
  return Boolean(
    input &&
    context.scopes.symbolFor(call.callee.object) === input &&
    context.scopes.symbolFor(branch.test) === input &&
    ref?.kind === "const" &&
    isNodeOfType(initializer, "CallExpression") &&
    isDirectNamedReactHookCall(initializer, "useRef", context.scopes) &&
    initializer.arguments.length === 1 &&
    isNodeOfType(initializer.arguments[0], "Literal") &&
    initializer.arguments[0].value === null &&
    component &&
    hasClosedFocusRefWiring(ref, acquisition, component, context),
  );
};
