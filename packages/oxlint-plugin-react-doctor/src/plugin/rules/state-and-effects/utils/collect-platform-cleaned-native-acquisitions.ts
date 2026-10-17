import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";
import { hasClosedPlatformSubscriptionProviders } from "./has-closed-platform-subscription-providers.js";
import {
  PLATFORM_SUBSCRIPTION_ARGUMENT_COUNT,
  PLATFORM_SUBSCRIPTION_BIND_ARGUMENT_COUNT,
  PLATFORM_SUBSCRIPTION_HELPER_STATEMENT_COUNT,
  PLATFORM_SUBSCRIPTION_REACT_MAX_ARGUMENT_COUNT,
  PLATFORM_SUBSCRIPTION_NATIVE_METHODS,
  PLATFORM_SUBSCRIPTION_OS_VALUES,
} from "./constants.js";

interface PlatformLifecycleCall {
  call: EsTreeNodeOfType<"CallExpression">;
  helperName: string;
  platform: string;
  providerId: number;
}

interface PlatformSubscriptionAcquisition {
  lifecycle: PlatformLifecycleCall;
  registration: EsTreeNodeOfType<"CallExpression">;
  target: EsTreeNodeOfType<"MemberExpression">;
  fieldName: string;
}

interface PlatformSubscriptionRelease {
  lifecycle: PlatformLifecycleCall;
  receiver: EsTreeNodeOfType<"MemberExpression">;
  fieldName: string;
}

const directThisMember = (expression: EsTreeNode): EsTreeNodeOfType<"MemberExpression"> | null => {
  const member = stripParenExpression(expression);
  return isNodeOfType(member, "MemberExpression") &&
    !member.computed &&
    !member.optional &&
    isNodeOfType(stripParenExpression(member.object), "ThisExpression")
    ? member
    : null;
};

const ordinaryFunctionBody = (
  member: EsTreeNode,
  allowAsync = false,
): EsTreeNodeOfType<"BlockStatement"> | null => {
  if (
    (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) ||
    member.static ||
    member.computed ||
    member.decorators?.length ||
    (isNodeOfType(member, "MethodDefinition") && member.kind !== "method") ||
    (isNodeOfType(member, "PropertyDefinition") &&
      !isNodeOfType(member.value, "ArrowFunctionExpression")) ||
    !isFunctionLike(member.value) ||
    member.value.generator ||
    (!allowAsync && member.value.async) ||
    member.value.params.length !== 0 ||
    !isNodeOfType(member.value.body, "BlockStatement")
  )
    return null;
  let suspended = false;
  walkOwnFunctionScope(member.value, (candidate) => {
    if (isNodeOfType(candidate, "AwaitExpression") || isNodeOfType(candidate, "YieldExpression"))
      suspended = true;
  });
  return suspended ? null : member.value.body;
};

const platformLifecycleCall = (
  statement: EsTreeNode,
  context: RuleContext,
): PlatformLifecycleCall | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const logical = stripParenExpression(statement.expression);
  if (!isNodeOfType(logical, "LogicalExpression") || logical.operator !== "&&") return null;
  const condition = stripParenExpression(logical.left);
  const call = stripParenExpression(logical.right);
  if (
    !isNodeOfType(condition, "BinaryExpression") ||
    condition.operator !== "===" ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 0
  )
    return null;
  const selector = stripParenExpression(condition.left);
  const platform = stripParenExpression(condition.right);
  const helper = directThisMember(call.callee);
  if (
    !isNodeOfType(selector, "MemberExpression") ||
    selector.computed ||
    selector.optional ||
    getStaticPropertyName(selector) !== "OS" ||
    !isNodeOfType(selector.object, "Identifier") ||
    !isNodeOfType(platform, "Literal") ||
    typeof platform.value !== "string" ||
    !PLATFORM_SUBSCRIPTION_OS_VALUES.has(platform.value) ||
    !helper
  )
    return null;
  const provider = context.scopes.symbolFor(selector.object);
  const helperName = getStaticPropertyName(helper);
  if (
    !provider ||
    !helperName ||
    getValueImportSource(provider) !== "react-native" ||
    getImportedName(provider.declarationNode) !== "Platform"
  )
    return null;
  return { call, helperName, platform: platform.value, providerId: provider.id };
};

const subscriptionAcquisition = (
  lifecycle: PlatformLifecycleCall,
  helper: EsTreeNode,
  context: RuleContext,
): PlatformSubscriptionAcquisition | null => {
  const body = ordinaryFunctionBody(helper);
  if (
    !body ||
    body.body.length !== PLATFORM_SUBSCRIPTION_HELPER_STATEMENT_COUNT ||
    !isNodeOfType(body.body[0], "ExpressionStatement")
  )
    return null;
  const assignment = stripParenExpression(body.body[0].expression);
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=") return null;
  const target = directThisMember(assignment.left);
  const registration = stripParenExpression(assignment.right);
  if (
    !target ||
    !isNodeOfType(registration, "CallExpression") ||
    registration.optional ||
    registration.arguments.length !== PLATFORM_SUBSCRIPTION_ARGUMENT_COUNT
  )
    return null;
  const callee = stripParenExpression(registration.callee);
  const event = registration.arguments[0];
  const callback = registration.arguments[1];
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    getStaticPropertyName(callee) !== "addListener" ||
    !isNodeOfType(callee.object, "Identifier") ||
    !isNodeOfType(event, "Literal") ||
    typeof event.value !== "string" ||
    !isNodeOfType(callback, "ArrowFunctionExpression")
  )
    return null;
  const provider = context.scopes.symbolFor(callee.object);
  const fieldName = getStaticPropertyName(target);
  if (
    !provider ||
    !fieldName ||
    getValueImportSource(provider) !== "react-native" ||
    getImportedName(provider.declarationNode) !== "Keyboard"
  )
    return null;
  return { lifecycle, registration, target, fieldName };
};

const subscriptionReleases = (
  lifecycle: PlatformLifecycleCall,
  helper: EsTreeNode,
): PlatformSubscriptionRelease[] | null => {
  const body = ordinaryFunctionBody(helper);
  if (!body || body.body.length === 0) return null;
  const releases: PlatformSubscriptionRelease[] = [];
  for (const statement of body.body) {
    if (!isNodeOfType(statement, "ExpressionStatement")) return null;
    const call = stripParenExpression(statement.expression);
    if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 0)
      return null;
    const callee = stripParenExpression(call.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      callee.optional ||
      getStaticPropertyName(callee) !== "remove"
    )
      return null;
    const receiver = directThisMember(callee.object);
    const fieldName = receiver && getStaticPropertyName(receiver);
    if (!receiver || !fieldName) return null;
    releases.push({ lifecycle, receiver, fieldName });
  }
  return releases;
};

const hasClosedClassReferences = (
  classNode: EsTreeNodeOfType<"ClassDeclaration">,
  context: RuleContext,
): boolean => {
  if (!classNode.id || classNode.decorators?.length) return false;
  const binding = context.scopes.symbolFor(classNode.id);
  const metadataNames = new Set<string>();
  return Boolean(
    binding &&
    binding.references.every((reference) => {
      const identifier = reference.identifier;
      if (isTypeScriptTypePosition(identifier)) return true;
      const root = findTransparentExpressionRoot(identifier);
      const parent = root.parent;
      if (
        reference.flag === "read" &&
        (isNodeOfType(parent, "ExportDefaultDeclaration") ||
          isNodeOfType(parent, "ExportSpecifier"))
      )
        return true;
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== root ||
        parent.computed ||
        parent.optional ||
        (getStaticPropertyName(parent) !== "propTypes" &&
          getStaticPropertyName(parent) !== "defaultProps")
      )
        return false;
      const metadataName = getStaticPropertyName(parent);
      if (!metadataName || metadataNames.has(metadataName)) return false;
      metadataNames.add(metadataName);
      const assignment = findTransparentExpressionRoot(parent).parent;
      return Boolean(
        isNodeOfType(assignment, "AssignmentExpression") &&
        assignment.operator === "=" &&
        assignment.left === findTransparentExpressionRoot(parent) &&
        isNodeOfType(assignment.right, "ObjectExpression") &&
        isNodeOfType(assignment.parent, "ExpressionStatement"),
      );
    }),
  );
};

export const collectPlatformCleanedNativeAcquisitions = (
  classBody: EsTreeNodeOfType<"ClassBody">,
  context: RuleContext,
): ReadonlySet<EsTreeNode> => {
  const classNode = classBody.parent;
  if (!isNodeOfType(classNode, "ClassDeclaration") || !hasClosedClassReferences(classNode, context))
    return new Set();
  const members = new Map<string, EsTreeNode>();
  const callableMembers = new Set<string>();
  let constructor: EsTreeNode | null = null;
  for (const member of classBody.body) {
    if (
      (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) ||
      member.computed ||
      member.decorators?.length ||
      (member.static && isNodeOfType(member, "MethodDefinition") && member.kind !== "method")
    )
      return new Set();
    const name = getStaticPropertyKeyName(member);
    if (
      !name ||
      members.has(name) ||
      name === "updater" ||
      name === "propTypes" ||
      name === "defaultProps"
    )
      return new Set();
    members.set(name, member);
    if (isNodeOfType(member, "MethodDefinition") && member.kind === "constructor") {
      if (
        member.static ||
        !isFunctionLike(member.value) ||
        member.value.async ||
        member.value.generator
      )
        return new Set();
      constructor = member.value;
      let returnsValue = false;
      walkOwnFunctionScope(member.value, (candidate) => {
        if (isNodeOfType(candidate, "ReturnStatement") && candidate.argument) returnsValue = true;
      });
      if (returnsValue) return new Set();
    }
    if (
      !member.static &&
      isFunctionLike(member.value) &&
      !member.value.generator &&
      ((isNodeOfType(member, "MethodDefinition") && member.kind === "method") ||
        (isNodeOfType(member, "PropertyDefinition") &&
          isNodeOfType(member.value, "ArrowFunctionExpression")))
    )
      callableMembers.add(name);
  }
  if (members.has("setState") || members.has("forceUpdate")) return new Set();
  const mount = members.get("componentDidMount");
  const cleanup = members.get("componentWillUnmount");
  if (!mount || !cleanup) return new Set();
  const mountBody = ordinaryFunctionBody(mount, true);
  const cleanupBody = ordinaryFunctionBody(cleanup);
  if (!mountBody || !cleanupBody) return new Set();
  const acquisitions: PlatformSubscriptionAcquisition[] = [];
  const byField = new Map<string, PlatformSubscriptionAcquisition>();
  const allowedHelperCalls = new Set<EsTreeNode>();
  const helperNames = new Set<string>();
  for (const statement of mountBody.body) {
    const lifecycle = platformLifecycleCall(statement, context);
    const helper = lifecycle && members.get(lifecycle.helperName);
    const entry = lifecycle && helper && subscriptionAcquisition(lifecycle, helper, context);
    if (!entry || byField.has(entry.fieldName) || helperNames.has(entry.lifecycle.helperName))
      return new Set();
    acquisitions.push(entry);
    byField.set(entry.fieldName, entry);
    helperNames.add(entry.lifecycle.helperName);
    allowedHelperCalls.add(entry.lifecycle.call);
  }
  if (acquisitions.length === 0) return new Set();
  if (!hasClosedPlatformSubscriptionProviders(classNode, context.scopes)) return new Set();
  const releases: PlatformSubscriptionRelease[] = [];
  const releasedFields = new Set<string>();
  for (const statement of cleanupBody.body) {
    const lifecycle = platformLifecycleCall(statement, context);
    const helper = lifecycle && members.get(lifecycle.helperName);
    const entries = lifecycle && helper && subscriptionReleases(lifecycle, helper);
    if (!entries || !lifecycle) break;
    for (const entry of entries) {
      const acquired = byField.get(entry.fieldName);
      if (
        !acquired ||
        releasedFields.has(entry.fieldName) ||
        acquired.lifecycle.providerId !== lifecycle.providerId ||
        acquired.lifecycle.platform !== lifecycle.platform
      )
        return new Set();
      releases.push(entry);
      releasedFields.add(entry.fieldName);
    }
    if (helperNames.has(lifecycle.helperName)) return new Set();
    helperNames.add(lifecycle.helperName);
    allowedHelperCalls.add(lifecycle.call);
  }
  if (releases.length === 0) return new Set();
  for (const fieldName of byField.keys()) {
    const declaration = members.get(fieldName);
    if (
      declaration &&
      (!isNodeOfType(declaration, "PropertyDefinition") ||
        declaration.static ||
        !isNodeOfType(declaration.value, "Literal") ||
        declaration.value.value !== null)
    )
      return new Set();
  }
  const allowedFields = new Set<EsTreeNode>([
    ...acquisitions.map((entry) => entry.target),
    ...releases.map((entry) => entry.receiver),
  ]);
  const allowedBindCalls = new Set<EsTreeNode>();
  const boundMethodNames = new Set<string>();
  walkAst(classBody, (candidate) => {
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      candidate.optional ||
      candidate.arguments.length !== PLATFORM_SUBSCRIPTION_BIND_ARGUMENT_COUNT ||
      !isNodeOfType(stripParenExpression(candidate.arguments[0]), "ThisExpression")
    )
      return;
    const bind = stripParenExpression(candidate.callee);
    if (
      !isNodeOfType(bind, "MemberExpression") ||
      bind.computed ||
      bind.optional ||
      getStaticPropertyName(bind) !== "bind"
    )
      return;
    const receiver = directThisMember(bind.object);
    const name = receiver && getStaticPropertyName(receiver);
    const member = name && members.get(name);
    if (
      !name ||
      !isNodeOfType(member, "MethodDefinition") ||
      member.kind !== "method" ||
      member.static ||
      !isFunctionLike(member.value) ||
      member.value.async ||
      member.value.generator ||
      helperNames.has(name) ||
      name === "componentDidMount" ||
      name === "componentWillUnmount" ||
      PLATFORM_SUBSCRIPTION_NATIVE_METHODS.has(name)
    )
      return;
    allowedBindCalls.add(candidate);
    boundMethodNames.add(name);
  });
  let closed = true;
  walkAst(classBody, (candidate) => {
    if (!closed || isTypeScriptTypePosition(candidate)) return false;
    if (isNodeOfType(candidate, "Super")) {
      const root = findTransparentExpressionRoot(candidate);
      const call = root.parent;
      if (
        !constructor ||
        findEnclosingFunction(candidate) !== constructor ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== root ||
        call.optional ||
        call.arguments.length > PLATFORM_SUBSCRIPTION_REACT_MAX_ARGUMENT_COUNT ||
        call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      )
        closed = false;
    }
    if (
      isNodeOfType(candidate, "ThisExpression") &&
      !directThisMember(findTransparentExpressionRoot(candidate).parent ?? candidate)
    ) {
      const consumer = findTransparentExpressionRoot(candidate).parent;
      if (!isNodeOfType(consumer, "CallExpression") || !allowedBindCalls.has(consumer))
        closed = false;
    }
    if (
      !isNodeOfType(candidate, "MemberExpression") ||
      !isNodeOfType(stripParenExpression(candidate.object), "ThisExpression")
    )
      return;
    const name = getStaticPropertyName(candidate);
    if (
      !name ||
      candidate.computed ||
      candidate.optional ||
      name === "updater" ||
      name === "componentDidMount" ||
      name === "componentWillUnmount"
    ) {
      closed = false;
      return;
    }
    const consumer = findTransparentExpressionRoot(candidate).parent;
    if (boundMethodNames.has(name)) {
      const bindCall = isNodeOfType(consumer, "MemberExpression")
        ? findTransparentExpressionRoot(consumer).parent
        : null;
      if (
        !(
          isNodeOfType(consumer, "CallExpression") &&
          consumer.callee === findTransparentExpressionRoot(candidate)
        ) &&
        !(
          isNodeOfType(consumer, "MemberExpression") &&
          consumer.object === findTransparentExpressionRoot(candidate) &&
          isNodeOfType(bindCall, "CallExpression") &&
          allowedBindCalls.has(bindCall)
        )
      )
        closed = false;
    }
    if (byField.has(name) && !allowedFields.has(candidate)) closed = false;
    if (
      (callableMembers.has(name) || PLATFORM_SUBSCRIPTION_NATIVE_METHODS.has(name)) &&
      isWithinAssignmentTarget(candidate)
    )
      closed = false;
    if (
      helperNames.has(name) &&
      (!isNodeOfType(consumer, "CallExpression") || !allowedHelperCalls.has(consumer))
    )
      closed = false;
    if (
      (isNodeOfType(consumer, "NewExpression") &&
        consumer.callee === findTransparentExpressionRoot(candidate)) ||
      (isNodeOfType(consumer, "TaggedTemplateExpression") &&
        consumer.tag === findTransparentExpressionRoot(candidate))
    )
      closed = false;
    if (
      !isNodeOfType(consumer, "CallExpression") ||
      consumer.callee !== findTransparentExpressionRoot(candidate)
    )
      return;
    if (consumer.optional) {
      closed = false;
      return;
    }
    if (callableMembers.has(name)) return;
    if (name === "forceUpdate") {
      if (consumer.arguments.length !== 0) closed = false;
      return;
    }
    if (name !== "setState") {
      closed = false;
      return;
    }
    const update = consumer.arguments[0];
    const completion = consumer.arguments[1];
    if (
      !isNodeOfType(update, "ObjectExpression") ||
      update.properties.some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          property.kind !== "init" ||
          property.method ||
          property.computed,
      ) ||
      consumer.arguments.length > PLATFORM_SUBSCRIPTION_REACT_MAX_ARGUMENT_COUNT ||
      (completion &&
        (!isNodeOfType(completion, "ArrowFunctionExpression") ||
          completion.generator ||
          completion.params.length !== 0))
    )
      closed = false;
  });
  return closed
    ? new Set(
        acquisitions
          .filter((entry) => releasedFields.has(entry.fieldName))
          .map((entry) => entry.registration),
      )
    : new Set();
};
