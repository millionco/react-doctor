import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { collectBoundedEffectExecutionFrames } from "./collect-effect-state-write-facts.js";
import {
  IMPERATIVE_COMMAND_ADJACENT_OFFSETS,
  IMPERATIVE_COMMAND_SINGLE_FRAME_COUNT,
  IMPERATIVE_COMMAND_UNSUPPORTED_FRAME_NODES,
} from "./constants.js";
import { getEffectFn } from "./effect/react.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isClosedImperativeRefAssignment } from "./is-closed-imperative-ref-assignment.js";
import { isClosedReactCommandHookCall } from "./is-closed-react-command-hook-call.js";

const hasSupportedFrame = (functionNode: EsTreeNode): boolean => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    (isNodeOfType(functionNode, "FunctionExpression") && functionNode.id)
  )
    return false;
  let supported = true;
  walkAst(functionNode, (node) => {
    if (node !== functionNode && isFunctionLike(node)) return false;
    if (IMPERATIVE_COMMAND_UNSUPPORTED_FRAME_NODES.has(node.type)) supported = false;
  });
  return supported;
};

const isExactCommandInvocation = (
  call: EsTreeNode,
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNodeOfType(call.callee, "Identifier") ||
    !isFunctionLike(functionNode) ||
    call.arguments.length !== functionNode.params.length
  )
    return false;
  const symbol = scopes.symbolFor(call.callee);
  if (
    !symbol ||
    symbol.scope.symbols.filter((candidate) => candidate.name === symbol.name).length !==
      IMPERATIVE_COMMAND_SINGLE_FRAME_COUNT ||
    symbol.references.some(
      (reference) =>
        !isTypeScriptTypePosition(reference.identifier) &&
        (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)),
    )
  )
    return false;
  if (symbol.declarationNode === functionNode)
    return resolveExactLocalFunction(call.callee, scopes) === functionNode;
  const initializer = getDirectConstInitializer(symbol);
  if (initializer === functionNode)
    return resolveExactLocalFunction(call.callee, scopes) === functionNode;
  return Boolean(
    initializer &&
    isNodeOfType(initializer, "CallExpression") &&
    initializer.arguments[0] === functionNode &&
    isClosedReactCommandHookCall(initializer, "useCallback", scopes),
  );
};

const hasAdjacentRefAssignment = (
  call: EsTreeNode,
  ownerFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  invocation: EsTreeNode | null = null,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;
  const statement = call.parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.expression !== call ||
    !isNodeOfType(statement.parent, "BlockStatement")
  )
    return false;
  const statements = statement.parent.body;
  const anchorIndex = statements.findIndex((candidate) => candidate === statement);
  return IMPERATIVE_COMMAND_ADJACENT_OFFSETS.some((offset) => {
    const neighbor = statements[anchorIndex + offset];
    return Boolean(
      neighbor && isClosedImperativeRefAssignment(neighbor, ownerFunction, scopes, invocation),
    );
  });
};

export const hasAdjacentImperativeRefCommand = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  effectNode: EsTreeNode,
  writeNode: EsTreeNode,
): boolean => {
  if (
    !isClosedReactCommandHookCall(effectNode, "useEffect", context.scopes) ||
    !isNodeOfType(effectNode, "CallExpression")
  )
    return false;
  const effectFunction = getEffectFn(analysis, effectNode);
  const ownerFunction = findEnclosingFunction(effectNode);
  const writeFunction = findEnclosingFunction(writeNode);
  if (
    !effectFunction ||
    !ownerFunction ||
    !writeFunction ||
    effectNode.arguments[0] !== effectFunction ||
    !isFunctionLike(effectFunction) ||
    effectFunction.params.length ||
    !hasSupportedFrame(effectFunction) ||
    !hasSupportedFrame(writeFunction)
  )
    return false;
  if (writeFunction === effectFunction)
    return hasAdjacentRefAssignment(writeNode, ownerFunction, context.scopes);
  const frames = collectBoundedEffectExecutionFrames(analysis, effectNode, context.filename).filter(
    (frame) => frame.functionNode === writeFunction,
  );
  if (frames.length !== IMPERATIVE_COMMAND_SINGLE_FRAME_COUNT) return false;
  const [frame] = frames;
  const invocation = frame?.invocation;
  if (
    !invocation ||
    frame.isDeferred ||
    findEnclosingFunction(invocation) !== effectFunction ||
    !isExactCommandInvocation(invocation, writeFunction, context.scopes)
  )
    return false;
  return (
    hasAdjacentRefAssignment(writeNode, ownerFunction, context.scopes, invocation) ||
    hasAdjacentRefAssignment(invocation, ownerFunction, context.scopes)
  );
};
