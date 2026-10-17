import { hasClosedNativeReactComponentBase } from "./has-closed-native-react-component-base.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { hasClosedNativeEmitterProgram } from "./has-closed-native-emitter-program.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "../../../utils/do-nodes-cover-every-path-from-function-entry.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";
import {
  NATIVE_EMITTER_ARGUMENT_COUNT,
  NATIVE_EMITTER_REACT_MAX_ARGUMENT_COUNT,
  NATIVE_EMITTER_INHERITED_REACT_METHOD_NAMES,
  NATIVE_EMITTER_UNSUPPORTED_CLEANUP_TYPES,
} from "./constants.js";

export const getOwnedNativeEmitterCleanup = (
  acquisition: EsTreeNode,
  classBody: EsTreeNodeOfType<"ClassBody">,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    !isNodeOfType(acquisition, "CallExpression") ||
    acquisition.optional ||
    acquisition.arguments.length !== NATIVE_EMITTER_ARGUMENT_COUNT
  )
    return null;
  const callee = stripParenExpression(acquisition.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    getStaticPropertyName(callee) !== "addListener"
  )
    return null;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const provider = context.scopes.symbolFor(receiver);
  if (
    !provider ||
    getValueImportSource(provider) !== "react-native" ||
    getImportedName(provider.declarationNode) !== "DeviceEventEmitter" ||
    !hasClosedNativeEmitterProgram(context.scopes)
  )
    return null;
  if (
    provider.references.some((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return false;
      const member = findTransparentExpressionRoot(reference.identifier).parent;
      const call = member ? findTransparentExpressionRoot(member).parent : null;
      return (
        reference.flag !== "read" ||
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== findTransparentExpressionRoot(reference.identifier) ||
        member.computed ||
        member.optional ||
        getStaticPropertyName(member) !== "addListener" ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== findTransparentExpressionRoot(member) ||
        call.optional
      );
    })
  )
    return null;
  const event = acquisition.arguments[0];
  const handler = acquisition.arguments[1];
  if (
    !isNodeOfType(event, "Literal") ||
    typeof event.value !== "string" ||
    !isNodeOfType(handler, "MemberExpression") ||
    handler.computed ||
    handler.optional ||
    !isNodeOfType(stripParenExpression(handler.object), "ThisExpression")
  )
    return null;
  const handlerName = getStaticPropertyName(handler);
  const assignment = findTransparentExpressionRoot(acquisition).parent;
  if (
    !handlerName ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.right !== findTransparentExpressionRoot(acquisition)
  )
    return null;
  const target = stripParenExpression(assignment.left);
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    target.optional ||
    !isNodeOfType(stripParenExpression(target.object), "ThisExpression")
  )
    return null;
  const fieldName = getStaticPropertyName(target);
  const classNode = classBody.parent;
  if (
    !fieldName ||
    !isNodeOfType(classNode, "ClassDeclaration") ||
    !classNode.id ||
    classNode.decorators?.length
  )
    return null;
  if (!hasClosedNativeReactComponentBase(classNode, context.scopes)) return null;
  const classBinding = context.scopes.symbolFor(classNode.id);
  if (
    !classBinding ||
    classBinding.references.some((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return false;
      const parent = findTransparentExpressionRoot(reference.identifier).parent;
      return (
        reference.flag !== "read" ||
        !(
          isNodeOfType(parent, "ExportDefaultDeclaration") ||
          isNodeOfType(parent, "ExportSpecifier")
        )
      );
    })
  )
    return null;
  const selectedMembers = new Map<string, EsTreeNode>();
  const callableMembers = new Map<string, EsTreeNode | null>();
  let fieldDeclarations = 0;
  let constructorCount = 0;
  for (const member of classBody.body) {
    if (isNodeOfType(member, "StaticBlock")) return null;
    if (
      (isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition")) &&
      member.computed
    )
      return null;
    const name = getStaticPropertyKeyName(member, { allowComputedString: true });
    if (name === "updater") return null;
    if (isNodeOfType(member, "MethodDefinition") && member.kind === "constructor") {
      constructorCount += 1;
      if (
        constructorCount > 1 ||
        member.static ||
        member.decorators?.length ||
        !isFunctionLike(member.value) ||
        member.value.async ||
        member.value.generator
      )
        return null;
      let returnsValue = false;
      walkOwnFunctionScope(member.value, (candidate) => {
        if (isNodeOfType(candidate, "ReturnStatement") && candidate.argument) returnsValue = true;
      });
      if (returnsValue) return null;
    }
    if (name) {
      const ordinaryMethod = isNodeOfType(member, "MethodDefinition") && member.kind === "method";
      const ordinaryArrow =
        isNodeOfType(member, "PropertyDefinition") &&
        isNodeOfType(member.value, "ArrowFunctionExpression");
      const callable =
        (ordinaryMethod || ordinaryArrow) &&
        (isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition")) &&
        !member.static &&
        !member.decorators?.length &&
        isFunctionLike(member.value) &&
        !member.value.async &&
        !member.value.generator
          ? member.value
          : null;
      callableMembers.set(name, callableMembers.has(name) ? null : callable);
    }

    if (name === fieldName) {
      if (
        !isNodeOfType(member, "PropertyDefinition") ||
        member.static ||
        member.computed ||
        member.decorators?.length ||
        !isNodeOfType(member.value, "Literal") ||
        member.value.value !== null
      )
        return null;
      fieldDeclarations += 1;
      if (fieldDeclarations > 1) return null;
    }
    if (name !== "componentDidMount" && name !== "componentWillUnmount" && name !== handlerName)
      continue;
    if (
      selectedMembers.has(name) ||
      (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) ||
      member.static ||
      member.computed ||
      member.decorators?.length ||
      (isNodeOfType(member, "MethodDefinition") && member.kind !== "method") ||
      !isFunctionLike(member.value)
    )
      return null;
    selectedMembers.set(name, member.value);
  }
  if (fieldDeclarations !== 1) return null;
  const mount = selectedMembers.get("componentDidMount");
  const cleanup = selectedMembers.get("componentWillUnmount");
  if (
    !mount ||
    !cleanup ||
    !selectedMembers.has(handlerName) ||
    !isFunctionLike(mount) ||
    !isFunctionLike(cleanup) ||
    mount.async ||
    mount.generator ||
    mount.params.length !== 0 ||
    cleanup.async ||
    cleanup.generator ||
    cleanup.params.length !== 0 ||
    !isNodeOfType(mount.body, "BlockStatement") ||
    !isNodeOfType(cleanup.body, "BlockStatement")
  )
    return null;
  const acquisitionStatement = assignment.parent;
  if (
    !isNodeOfType(acquisitionStatement, "ExpressionStatement") ||
    acquisitionStatement.parent !== mount.body ||
    findEnclosingFunction(acquisition) !== mount
  )
    return null;
  let release: EsTreeNodeOfType<"CallExpression"> | null = null;
  let guard: EsTreeNode | null = null;
  for (const statement of cleanup.body.body) {
    let expression: EsTreeNode | null = null;
    let test: EsTreeNode | null = null;
    if (isNodeOfType(statement, "ExpressionStatement"))
      expression = stripParenExpression(statement.expression);
    if (isNodeOfType(statement, "IfStatement") && !statement.alternate) {
      const consequent = statement.consequent;
      const statements = isNodeOfType(consequent, "BlockStatement")
        ? consequent.body
        : [consequent];
      if (statements.length === 1 && isNodeOfType(statements[0], "ExpressionStatement")) {
        test = stripParenExpression(statement.test);
        expression = stripParenExpression(statements[0].expression);
      }
    }
    if (
      !isNodeOfType(expression, "CallExpression") ||
      expression.optional ||
      expression.arguments.length !== 0
    )
      continue;
    const remove = stripParenExpression(expression.callee);
    if (
      !isNodeOfType(remove, "MemberExpression") ||
      remove.computed ||
      remove.optional ||
      getStaticPropertyName(remove) !== "remove"
    )
      continue;
    const handle = stripParenExpression(remove.object);
    if (
      !isNodeOfType(handle, "MemberExpression") ||
      handle.computed ||
      handle.optional ||
      !isNodeOfType(stripParenExpression(handle.object), "ThisExpression") ||
      getStaticPropertyName(handle) !== fieldName
    )
      continue;
    if (
      test &&
      (!isNodeOfType(test, "MemberExpression") ||
        test.computed ||
        test.optional ||
        !isNodeOfType(stripParenExpression(test.object), "ThisExpression") ||
        getStaticPropertyName(test) !== fieldName)
    )
      continue;
    if (release) return null;
    release = expression;
    guard = test;
  }
  if (!release || !doNodesCoverEveryPathFromFunctionEntry(cleanup, [guard ?? release], context))
    return null;
  const selectedRelease = release;
  const selectedGuard = guard;
  let closed = true;
  walkOwnFunctionScope(cleanup, (candidate) => {
    if (
      NATIVE_EMITTER_UNSUPPORTED_CLEANUP_TYPES.has(candidate.type) ||
      ((isNodeOfType(candidate, "ReturnStatement") || isNodeOfType(candidate, "ThrowStatement")) &&
        candidate.range[0] < selectedRelease.range[0])
    )
      closed = false;
  });
  walkAst(classBody, (candidate) => {
    if (!closed || isTypeScriptTypePosition(candidate)) return false;
    if (isNodeOfType(candidate, "Super")) {
      const consumer = findTransparentExpressionRoot(candidate).parent;
      if (
        !isNodeOfType(consumer, "CallExpression") ||
        consumer.callee !== findTransparentExpressionRoot(candidate) ||
        consumer.arguments.length > NATIVE_EMITTER_REACT_MAX_ARGUMENT_COUNT ||
        consumer.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      )
        closed = false;
    }
    if (isNodeOfType(candidate, "ThisExpression")) {
      const member = findTransparentExpressionRoot(candidate).parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== findTransparentExpressionRoot(candidate) ||
        member.computed ||
        !getStaticPropertyName(member)
      ) {
        closed = false;
        return false;
      }
    }
    if (
      !isNodeOfType(candidate, "MemberExpression") ||
      !isNodeOfType(stripParenExpression(candidate.object), "ThisExpression")
    )
      return;
    const name = getStaticPropertyName(candidate);
    if (name === "componentDidMount" || name === "componentWillUnmount" || name === "updater") {
      closed = false;
      return;
    }
    if (
      (name === handlerName ||
        Boolean(callableMembers.get(name ?? "")) ||
        NATIVE_EMITTER_INHERITED_REACT_METHOD_NAMES.has(name ?? "")) &&
      isWithinAssignmentTarget(candidate)
    )
      closed = false;
    const consumer = findTransparentExpressionRoot(candidate).parent;
    if (
      (isNodeOfType(consumer, "TaggedTemplateExpression") &&
        consumer.tag === findTransparentExpressionRoot(candidate)) ||
      (isNodeOfType(consumer, "NewExpression") &&
        consumer.callee === findTransparentExpressionRoot(candidate))
    )
      closed = false;
    if (
      isNodeOfType(consumer, "CallExpression") &&
      consumer.callee === findTransparentExpressionRoot(candidate)
    ) {
      if (
        !name ||
        (callableMembers.has(name)
          ? !callableMembers.get(name)
          : !NATIVE_EMITTER_INHERITED_REACT_METHOD_NAMES.has(name))
      )
        closed = false;
      if (
        name &&
        !callableMembers.has(name) &&
        NATIVE_EMITTER_INHERITED_REACT_METHOD_NAMES.has(name)
      ) {
        if (name === "forceUpdate") {
          if (consumer.arguments.length !== 0) closed = false;
        } else {
          const update = consumer.arguments[0];
          const completion = consumer.arguments[1];
          if (
            !isNodeOfType(update, "ObjectExpression") ||
            consumer.arguments.length > NATIVE_EMITTER_REACT_MAX_ARGUMENT_COUNT ||
            (completion &&
              (!isNodeOfType(completion, "ArrowFunctionExpression") ||
                completion.async ||
                completion.generator ||
                completion.params.length !== 0))
          )
            closed = false;
        }
      }
    }
    if (name !== fieldName) return;
    const releaseCallee = stripParenExpression(selectedRelease.callee);
    const releaseReceiver = isNodeOfType(releaseCallee, "MemberExpression")
      ? stripParenExpression(releaseCallee.object)
      : null;
    if (candidate !== target && candidate !== selectedGuard && candidate !== releaseReceiver)
      closed = false;
  });
  return closed ? selectedRelease : null;
};
