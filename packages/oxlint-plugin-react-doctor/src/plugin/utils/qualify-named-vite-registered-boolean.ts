import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasUnsafeArrayIterationIntrinsics } from "./has-unsafe-array-iteration-intrinsics.js";
import { hasClosedRegistryChildCarriers } from "./has-closed-registry-child-carriers.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isVerifiedIsomorphicReactEffect } from "./is-verified-isomorphic-react-effect.js";
import { inspectRegisteredBooleanRecordReads } from "./check-registered-boolean-record-reads.js";
import type { BoundNode } from "./project-named-vite-omitted-boolean.js";
import {
  bindingUses,
  lexical,
  matchValue,
  projectNamedViteOmittedBoolean,
  projectNamedViteOmittedNull,
  sameValue,
} from "./project-named-vite-omitted-boolean.js";
import type {
  ConsumerTarget,
  RegisteredBooleanForwarding,
} from "./qualify-registered-boolean-forwarding.js";
import {
  isStockCall,
  readRegisteredBooleanForwarding,
} from "./qualify-registered-boolean-forwarding.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const same = (module: NamedViteSourceModule, a: EsTreeNode, b: EsTreeNode) => {
  const symbol = lexical(module, a);
  return Boolean(symbol && symbol === lexical(module, b));
};
const sole = <T>(items: readonly T[]) => (items.length === 1 ? items[0] : undefined);
const member = (node: EsTreeNode | null | undefined, key: string) =>
  isNodeOfType(node, "MemberExpression") && !node.optional && getStaticPropertyName(node) === key
    ? node.object
    : null;

const isClosedReactCallbackRelay = (
  project: NamedViteSourceProject,
  relay: BoundNode | null,
): boolean => {
  if (
    !relay ||
    !isNodeOfType(relay.node, "FunctionDeclaration") ||
    relay.node.async ||
    relay.node.generator ||
    !relay.node.body ||
    relay.node.body.body.length !== 3 ||
    relay.node.params.length !== 1 ||
    !isNodeOfType(relay.node.params[0], "Identifier")
  )
    return false;
  const { module } = relay;
  const callback = relay.node.params[0];
  const [capture, refresh, returner] = relay.node.body.body;
  const holding =
    isNodeOfType(capture, "VariableDeclaration") && capture.kind === "const"
      ? sole(capture.declarations)
      : null;
  const captureCall = holding?.init ?? null;
  if (
    !holding ||
    !isNodeOfType(holding.id, "Identifier") ||
    !isStockCall(module, captureCall, "useRef") ||
    captureCall.arguments.length !== 1 ||
    !same(module, captureCall.arguments[0], callback)
  )
    return false;
  const update = isNodeOfType(refresh, "ExpressionStatement") ? refresh.expression : null;
  if (
    !isNodeOfType(update, "CallExpression") ||
    update.arguments.length !== 1 ||
    !(
      isStockCall(module, update, "useLayoutEffect") ||
      isVerifiedIsomorphicReactEffect(project, module, update)
    )
  )
    return false;
  const synchronize = update.arguments[0];
  if (
    !isNodeOfType(synchronize, "ArrowFunctionExpression") ||
    synchronize.async ||
    synchronize.params.length ||
    !isNodeOfType(synchronize.body, "BlockStatement")
  )
    return false;
  const change = sole(synchronize.body.body);
  const write = isNodeOfType(change, "ExpressionStatement") ? change.expression : null;
  const ref = isNodeOfType(write, "AssignmentExpression") ? member(write.left, "current") : null;
  if (
    !isNodeOfType(write, "AssignmentExpression") ||
    write.operator !== "=" ||
    !ref ||
    !same(module, ref, holding.id) ||
    !same(module, write.right, callback)
  )
    return false;
  const memo = isNodeOfType(returner, "ReturnStatement") ? (returner.argument ?? null) : null;
  if (
    !isStockCall(module, memo, "useCallback") ||
    memo.arguments.length !== 2 ||
    !isNodeOfType(memo.arguments[1], "ArrayExpression") ||
    memo.arguments[1].elements.length
  )
    return false;
  const dispatch = memo.arguments[0];
  if (
    !isNodeOfType(dispatch, "ArrowFunctionExpression") ||
    dispatch.async ||
    dispatch.params.length !== 1 ||
    !isNodeOfType(dispatch.params[0], "RestElement") ||
    !isNodeOfType(dispatch.params[0].argument, "Identifier")
  )
    return false;
  const invocation = isNodeOfType(dispatch.body, "ChainExpression")
    ? dispatch.body.expression
    : dispatch.body;
  if (!isNodeOfType(invocation, "CallExpression") || invocation.arguments.length !== 1)
    return false;
  const invokeRef = member(invocation.callee, "current");
  const operand = invocation.arguments[0];
  return Boolean(
    invokeRef &&
    same(module, invokeRef, holding.id) &&
    isNodeOfType(operand, "SpreadElement") &&
    same(module, operand.argument, dispatch.params[0].argument),
  );
};

const readDormantHandle = (
  project: NamedViteSourceProject,
  borrow: BoundNode,
): readonly [string, string] | null => {
  const { module, node } = borrow;
  const closure = node.parent;
  if (
    !isNodeOfType(closure, "ArrowFunctionExpression") ||
    closure.async ||
    closure.params.length ||
    closure.body !== node
  )
    return null;
  const explicit = closure.parent;
  if (
    !isNodeOfType(explicit, "CallExpression") ||
    explicit.optional ||
    explicit.arguments.length !== 1 ||
    explicit.arguments[0] !== closure ||
    !isClosedReactCallbackRelay(project, matchValue(project, module, explicit.callee))
  )
    return null;
  const declared = explicit.parent;
  if (
    !isNodeOfType(declared, "VariableDeclarator") ||
    declared.init !== explicit ||
    !isNodeOfType(declared.id, "Identifier") ||
    !isNodeOfType(declared.parent, "VariableDeclaration") ||
    declared.parent.kind !== "const"
  )
    return null;
  const callback = lexical(module, declared.id);
  if (!callback || callback.references.some((use) => use.flag !== "read")) return null;
  const uses = bindingUses(callback);
  const recordUse = sole(
    uses.filter(
      (use) =>
        isNodeOfType(use.parent, "Property") &&
        use.parent.value === use &&
        !use.parent.computed &&
        use.parent.kind === "init" &&
        !use.parent.method,
    ),
  );
  const dependencyUse = sole(uses.filter((use) => isNodeOfType(use.parent, "ArrayExpression")));
  if (uses.length !== 2 || !recordUse || !dependencyUse) return null;
  const record = recordUse.parent?.parent;
  if (!isNodeOfType(record, "ObjectExpression")) return null;
  const returnObject = findTransparentExpressionRoot(record);
  const factory = returnObject.parent;
  if (
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    factory.params.length ||
    factory.body !== returnObject
  )
    return null;
  const handle = factory.parent ?? null;
  if (
    !isStockCall(module, handle, "useImperativeHandle") ||
    handle.arguments.length !== 3 ||
    handle.arguments[1] !== factory ||
    handle.arguments[2] !== dependencyUse.parent
  )
    return null;
  const destination = handle.arguments[0];
  if (
    !isNodeOfType(destination, "MemberExpression") ||
    destination.optional ||
    !isNodeOfType(destination.object, "Identifier")
  )
    return null;
  const key = getStaticPropertyName(destination);
  const options = lexical(module, destination.object);
  const owner = options?.declarationNode;
  if (
    !key ||
    !options ||
    !isNodeOfType(owner, "VariableDeclarator") ||
    !isNodeOfType(owner.id, "ObjectPattern") ||
    !owner.init ||
    !same(module, owner.init, node)
  )
    return null;
  const prop = sole(
    owner.id.properties.filter(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        property.value === options.bindingIdentifier,
    ),
  );
  const field = prop && getStaticPropertyKeyName(prop);
  return field ? [field, key] : null;
};

// A verified import graph still admits local DOM Window aliases. Explicit
// reflective prototype routes through an arbitrary receiver can replace a
// reducer or data-record intrinsic even when it is not a named global.
const hasPrototypeAccess = (module: NamedViteSourceModule): boolean => {
  const reflectiveFields = new Set([
    "__proto__",
    "prototype",
    "constructor",
    "getPrototypeOf",
    "setPrototypeOf",
    "defineProperty",
    "defineProperties",
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
  ]);
  let unsafe = false;
  walkAst(module.programNode, (node) => {
    if (unsafe) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      unsafe = reflectiveFields.has(getResolvedStaticPropertyName(node, module.scopes) ?? "");
    } else if (isNodeOfType(node, "ObjectPattern")) {
      unsafe = node.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          reflectiveFields.has(getStaticPropertyKeyName(property) ?? ""),
      );
    } else if (isNodeOfType(node, "Literal") && typeof node.value === "string") {
      unsafe = reflectiveFields.has(node.value);
    }
  });
  return unsafe;
};

export interface NamedViteRegisteredBooleanQualification extends RegisteredBooleanForwarding {
  readonly value: false;
}

export const qualifyNamedViteRegisteredBoolean = (
  project: NamedViteSourceProject,
  target: ConsumerTarget,
): NamedViteRegisteredBooleanQualification | null => {
  if (
    [...project.modulesByFilePath.values()].some(
      (module) =>
        hasUnsafeArrayIterationIntrinsics(module.programNode, module.scopes) ||
        hasPrototypeAccess(module),
    )
  )
    return null;
  const base = projectNamedViteOmittedBoolean(project, [target.recordField, target.booleanField]);
  const forwarding = base && readRegisteredBooleanForwarding(project, base, target);
  if (!base || !forwarding || !hasClosedRegistryChildCarriers(project, forwarding)) return null;
  const reads = inspectRegisteredBooleanRecordReads(project, base, forwarding, target.recordField);
  if (!reads) return null;
  const pending = reads.remainingWholeCarrierUses;
  if (!pending.length) return { ...forwarding, value: false };
  const borrow = sole(pending);
  const handle = borrow && readDormantHandle(project, borrow);
  if (!borrow || !handle) return null;
  const inserted = projectNamedViteOmittedNull(project, handle);
  if (
    !inserted ||
    !sameValue(inserted.owner, base.owner) ||
    inserted.assembledBinding !== base.assembledBinding
  )
    return null;
  const controller = inspectRegisteredBooleanRecordReads(project, inserted, forwarding, handle[0]);
  if (!controller || sole(controller.remainingWholeCarrierUses)?.node !== borrow.node) return null;
  return { ...forwarding, value: false };
};
