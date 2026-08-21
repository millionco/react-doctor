import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { resolveStaticLocalCallFunction } from "../../utils/get-order-independent-local-function.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { isSynchronousIteratorCallback } from "../../utils/is-synchronous-iterator-callback.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface DirectInstancedBufferMutation {
  readonly bufferPropertyName: "instanceColor" | "instanceMatrix" | "morphTexture";
  readonly methodName: "setColorAt" | "setMatrixAt" | "setMorphAt";
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly receiver: EsTreeNode;
  readonly receiverKey: string;
}

interface DirectInstancedBufferCompletion {
  readonly bufferPropertyName: "instanceColor" | "instanceMatrix" | "morphTexture";
  readonly coverageNode: EsTreeNode;
  readonly node: EsTreeNode;
  readonly receiverKeys: ReadonlySet<string>;
}

interface InstancedMeshReceiverKeys {
  readonly keys: ReadonlySet<string>;
  readonly staticIterationNode: EsTreeNode | null;
}

const getInstancedMeshReceiverKeys = (
  expression: EsTreeNode,
  context: RuleContext,
): InstancedMeshReceiverKeys => {
  const receiverKey = resolveExpressionKey(expression, context);
  const receiverKeys = new Set<string>();
  if (receiverKey) receiverKeys.add(receiverKey);
  const receiver = stripParenExpression(expression);
  if (!isNodeOfType(receiver, "Identifier")) {
    return { keys: receiverKeys, staticIterationNode: null };
  }
  const symbol = context.scopes.symbolFor(receiver);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "VariableDeclarator")) {
    return { keys: receiverKeys, staticIterationNode: null };
  }
  const declaration = symbol.declarationNode.parent;
  const forOfStatement = declaration?.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    !isNodeOfType(forOfStatement, "ForOfStatement") ||
    forOfStatement.left !== declaration
  ) {
    return { keys: receiverKeys, staticIterationNode: null };
  }
  const collection = stripParenExpression(forOfStatement.right);
  if (!isNodeOfType(collection, "ArrayExpression") || collection.elements.length === 0) {
    return { keys: receiverKeys, staticIterationNode: null };
  }
  for (const element of collection.elements) {
    if (!element || isNodeOfType(element, "SpreadElement")) continue;
    const elementKey = resolveExpressionKey(element, context);
    if (elementKey) receiverKeys.add(elementKey);
  }
  return { keys: receiverKeys, staticIterationNode: forOfStatement };
};

const getInstancedBufferMutation = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): DirectInstancedBufferMutation | null => {
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (methodName !== "setMatrixAt" && methodName !== "setColorAt" && methodName !== "setMorphAt") {
    return null;
  }
  if (getThreeConstructorName(callee.object, context.scopes) !== "InstancedMesh") return null;
  const receiverKey = resolveExpressionKey(callee.object, context);
  if (!receiverKey) return null;
  return {
    bufferPropertyName:
      methodName === "setMatrixAt"
        ? "instanceMatrix"
        : methodName === "setColorAt"
          ? "instanceColor"
          : "morphTexture",
    methodName,
    node,
    receiver: callee.object,
    receiverKey,
  };
};

const isDirectNonEscapingReceiverReference = (reference: EsTreeNode): boolean => {
  let referenceRoot = reference;
  while (
    isNodeOfType(referenceRoot.parent, "MemberExpression") &&
    referenceRoot.parent.object === referenceRoot
  ) {
    referenceRoot = referenceRoot.parent;
  }
  const parent = referenceRoot.parent;
  if (isNodeOfType(parent, "CallExpression") && parent.callee === referenceRoot) return true;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments.some((argument) => argument === referenceRoot) &&
    isNodeOfType(parent.callee, "MemberExpression") &&
    getStaticPropertyName(parent.callee) === "add"
  ) {
    return false;
  }
  if (isNodeOfType(parent, "AssignmentExpression") && parent.left === referenceRoot) return true;
  if (isNodeOfType(parent, "UpdateExpression") && parent.argument === referenceRoot) return true;
  return false;
};

const resolveSameClassMethod = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode | null => {
  const callee = stripParenExpression(callExpression.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
  ) {
    return null;
  }
  const methodName = getStaticPropertyName(callee);
  const caller = context.cfg.enclosingFunction(callExpression);
  const callerDefinition = caller?.parent;
  const classBody = callerDefinition?.parent;
  if (
    !methodName ||
    !isNodeOfType(callerDefinition, "MethodDefinition") ||
    callerDefinition.value !== caller ||
    !isNodeOfType(classBody, "ClassBody")
  ) {
    return null;
  }
  for (const member of classBody.body) {
    if (
      isNodeOfType(member, "MethodDefinition") &&
      !member.static &&
      getStaticPropertyKeyName(member, { allowComputedString: true }) === methodName &&
      isFunctionLike(member.value)
    ) {
      return member.value;
    }
  }
  return null;
};

const doesSameClassMethodKeepArgumentLocal = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  argument: EsTreeNode,
  context: RuleContext,
): boolean => {
  const argumentIndex = callExpression.arguments.findIndex((candidate) => candidate === argument);
  if (argumentIndex < 0) return false;
  const method = resolveSameClassMethod(callExpression, context);
  const parameter = method && isFunctionLike(method) ? method.params[argumentIndex] : null;
  if (!parameter || !isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = context.scopes.symbolFor(parameter);
  return Boolean(
    parameterSymbol &&
    parameterSymbol.references.every((reference) =>
      isDirectNonEscapingReceiverReference(reference.identifier),
    ),
  );
};

const isNonEscapingReceiverReference = (reference: EsTreeNode, context: RuleContext): boolean => {
  if (isDirectNonEscapingReceiverReference(reference)) return true;
  let referenceRoot = reference;
  while (
    isNodeOfType(referenceRoot.parent, "MemberExpression") &&
    referenceRoot.parent.object === referenceRoot
  ) {
    referenceRoot = referenceRoot.parent;
  }
  const parent = referenceRoot.parent;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments.some((argument) => argument === referenceRoot) &&
    isNodeOfType(parent.callee, "MemberExpression") &&
    getStaticPropertyName(parent.callee) === "add"
  ) {
    const ownerName = getThreeConstructorName(parent.callee.object, context.scopes);
    if (ownerName === "Group" || ownerName === "Object3D" || ownerName === "Scene") return true;
  }
  return Boolean(
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments.some((argument) => argument === referenceRoot) &&
    doesSameClassMethodKeepArgumentLocal(parent, referenceRoot, context),
  );
};

const isPreEscapeInitializationMutation = (
  mutation: DirectInstancedBufferMutation,
  context: RuleContext,
): boolean => {
  const receiver = stripParenExpression(mutation.receiver);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  let mutationOwner = context.cfg.enclosingFunction(mutation.node);
  while (
    isFunctionLike(mutationOwner) &&
    !mutationOwner.async &&
    !mutationOwner.generator &&
    isSynchronousIteratorCallback(mutationOwner) &&
    isNodeOfType(mutationOwner.parent, "CallExpression")
  ) {
    mutationOwner = context.cfg.enclosingFunction(mutationOwner.parent);
  }
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isNodeOfType(symbol.initializer, "NewExpression") ||
    getThreeConstructorName(symbol.initializer, context.scopes) !== "InstancedMesh" ||
    context.cfg.enclosingFunction(symbol.declarationNode) !== mutationOwner
  ) {
    return false;
  }
  const mutationStart = getRangeStart(mutation.node);
  if (mutationStart === null) return false;
  return symbol.references.every((reference) => {
    const referenceStart = getRangeStart(reference.identifier);
    return (
      referenceStart === null ||
      referenceStart >= mutationStart ||
      isNonEscapingReceiverReference(reference.identifier, context)
    );
  });
};

const getDirectLocalFunctionCallSites = (
  localFunction: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<EsTreeNodeOfType<"CallExpression">> | null => {
  let bindingIdentifier: EsTreeNode | null = null;
  if (isNodeOfType(localFunction, "FunctionDeclaration")) {
    bindingIdentifier = localFunction.id;
  } else if (
    isNodeOfType(localFunction.parent, "VariableDeclarator") &&
    localFunction.parent.init === localFunction &&
    isNodeOfType(localFunction.parent.id, "Identifier")
  ) {
    bindingIdentifier = localFunction.parent.id;
  }
  if (!bindingIdentifier) return null;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol || symbol.references.length === 0) return null;
  const callSites: EsTreeNodeOfType<"CallExpression">[] = [];
  for (const reference of symbol.references) {
    const parent = reference.identifier.parent;
    if (!isNodeOfType(parent, "CallExpression") || parent.callee !== reference.identifier) {
      return null;
    }
    if (resolveStaticLocalCallFunction(parent, context.scopes) !== localFunction) return null;
    callSites.push(parent);
  }
  return callSites;
};

const getInstancedBufferCompletion = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): DirectInstancedBufferCompletion | null => {
  const assignedValue = stripParenExpression(node.right);
  const needsUpdateMember = stripParenExpression(node.left);
  if (
    node.operator !== "=" ||
    !isNodeOfType(assignedValue, "Literal") ||
    assignedValue.value !== true ||
    !isNodeOfType(needsUpdateMember, "MemberExpression") ||
    getStaticPropertyName(needsUpdateMember) !== "needsUpdate"
  ) {
    return null;
  }
  const bufferMember = stripParenExpression(needsUpdateMember.object);
  if (!isNodeOfType(bufferMember, "MemberExpression")) return null;
  const bufferPropertyName = getStaticPropertyName(bufferMember);
  if (
    bufferPropertyName !== "instanceMatrix" &&
    bufferPropertyName !== "instanceColor" &&
    bufferPropertyName !== "morphTexture"
  ) {
    return null;
  }
  const receiverProof = getInstancedMeshReceiverKeys(bufferMember.object, context);
  if (
    getThreeConstructorName(bufferMember.object, context.scopes) !== "InstancedMesh" &&
    receiverProof.keys.size < 2
  ) {
    return null;
  }
  return receiverProof.keys.size > 0
    ? {
        bufferPropertyName,
        coverageNode: receiverProof.staticIterationNode ?? node,
        node,
        receiverKeys: receiverProof.keys,
      }
    : null;
};

const getOpaqueInstancedBufferCompletions = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ReadonlyArray<DirectInstancedBufferCompletion> => {
  if (!isImportedOrStableParameterCall(node, context.scopes)) return [];
  const completions: DirectInstancedBufferCompletion[] = [];
  for (const argument of node.arguments) {
    if (isNodeOfType(argument, "SpreadElement")) continue;
    const candidate = stripParenExpression(argument);
    if (isNodeOfType(candidate, "MemberExpression")) {
      const bufferPropertyName = getStaticPropertyName(candidate);
      if (
        (bufferPropertyName === "instanceMatrix" ||
          bufferPropertyName === "instanceColor" ||
          bufferPropertyName === "morphTexture") &&
        getThreeConstructorName(candidate.object, context.scopes) === "InstancedMesh"
      ) {
        const receiverProof = getInstancedMeshReceiverKeys(candidate.object, context);
        if (receiverProof.keys.size > 0) {
          completions.push({
            bufferPropertyName,
            coverageNode: receiverProof.staticIterationNode ?? node,
            node,
            receiverKeys: receiverProof.keys,
          });
        }
        continue;
      }
    }
    if (getThreeConstructorName(candidate, context.scopes) !== "InstancedMesh") continue;
    const receiverProof = getInstancedMeshReceiverKeys(candidate, context);
    if (receiverProof.keys.size === 0) continue;
    const coverageNode = receiverProof.staticIterationNode ?? node;
    completions.push({
      bufferPropertyName: "instanceMatrix",
      coverageNode,
      node,
      receiverKeys: receiverProof.keys,
    });
    completions.push({
      bufferPropertyName: "instanceColor",
      coverageNode,
      node,
      receiverKeys: receiverProof.keys,
    });
    completions.push({
      bufferPropertyName: "morphTexture",
      coverageNode,
      node,
      receiverKeys: receiverProof.keys,
    });
  }
  return completions;
};

const isTrueLiteral = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "Literal") && expression.value === true;
};

const isMutationFlagGuard = (
  candidate: EsTreeNode,
  mutation: DirectInstancedBufferMutation,
  completion: DirectInstancedBufferCompletion,
  context: RuleContext,
): boolean => {
  const identifier = stripParenExpression(candidate);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  const initializer = symbol?.initializer && stripParenExpression(symbol.initializer);
  if (
    !symbol ||
    !initializer ||
    !isNodeOfType(initializer, "Literal") ||
    initializer.value !== false
  ) {
    return false;
  }
  const trueAssignments: EsTreeNode[] = [];
  for (const reference of symbol.references) {
    const assignment = reference.identifier.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.left !== reference.identifier
    ) {
      continue;
    }
    if (assignment.operator !== "=" || !isTrueLiteral(assignment.right)) return false;
    trueAssignments.push(assignment);
  }
  const completionStart = getRangeStart(completion.coverageNode);
  const precedingTrueAssignments = trueAssignments.filter((assignment) => {
    const assignmentStart = getRangeStart(assignment);
    return (
      completionStart !== null && assignmentStart !== null && assignmentStart < completionStart
    );
  });
  return (
    precedingTrueAssignments.length > 0 &&
    doNodesCoverEveryPathAfterNode(mutation.node, precedingTrueAssignments, context)
  );
};

const isGuardGuaranteedAfterMutation = (
  candidate: EsTreeNode,
  mutation: DirectInstancedBufferMutation,
  completion: DirectInstancedBufferCompletion,
  context: RuleContext,
): boolean => {
  const guard = stripParenExpression(candidate);
  if (isNodeOfType(guard, "LogicalExpression") && guard.operator === "&&") {
    return (
      isGuardGuaranteedAfterMutation(guard.left, mutation, completion, context) &&
      isGuardGuaranteedAfterMutation(guard.right, mutation, completion, context)
    );
  }
  if (
    isNodeOfType(guard, "MemberExpression") &&
    getStaticPropertyName(guard) === completion.bufferPropertyName &&
    completion.receiverKeys.has(resolveExpressionKey(guard.object, context) ?? "")
  ) {
    return true;
  }
  return isMutationFlagGuard(guard, mutation, completion, context);
};

const completionCoversMutation = (
  mutation: DirectInstancedBufferMutation,
  completions: ReadonlyArray<DirectInstancedBufferCompletion>,
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const doesCompletionCoverAnchor = (
    initialPathAnchor: EsTreeNode,
    visitedFunctions: Set<EsTreeNode>,
  ): boolean => {
    let pathAnchor = initialPathAnchor;
    while (true) {
      const owner = context.cfg.enclosingFunction(pathAnchor);
      const matchingCompletions = completions.filter(
        (completion) =>
          completion.receiverKeys.has(mutation.receiverKey) &&
          completion.bufferPropertyName === mutation.bufferPropertyName &&
          context.cfg.enclosingFunction(completion.coverageNode) === owner,
      );
      if (owner) {
        const anchorStart = getRangeStart(pathAnchor);
        const hasMatchingBufferGuard = matchingCompletions.some((completion) => {
          const completionStart = getRangeStart(completion.coverageNode);
          if (anchorStart === null || completionStart === null || completionStart <= anchorStart) {
            return false;
          }
          let currentChild = completion.node;
          let currentAncestor = completion.node.parent;
          while (currentAncestor && currentAncestor !== owner) {
            if (
              isNodeOfType(currentAncestor, "IfStatement") &&
              currentAncestor.consequent === currentChild &&
              !isNodeConditionallyExecuted(completion.node, currentAncestor.consequent)
            ) {
              if (
                isGuardGuaranteedAfterMutation(currentAncestor.test, mutation, completion, context)
              ) {
                return true;
              }
            }
            currentChild = currentAncestor;
            currentAncestor = currentAncestor.parent;
          }
          return false;
        });
        if (hasMatchingBufferGuard) return true;
        if (
          doNodesCoverEveryPathAfterNode(
            pathAnchor,
            matchingCompletions.map((completion) => completion.coverageNode),
            context,
          )
        ) {
          return true;
        }
        if (!isFunctionLike(owner) || owner.async || owner.generator) return false;
        if (isSynchronousIteratorCallback(owner)) {
          const iteratorCall = owner.parent;
          if (!isNodeOfType(iteratorCall, "CallExpression")) return false;
          pathAnchor = iteratorCall;
          continue;
        }
        const callSites = getDirectLocalFunctionCallSites(owner, context);
        if (!callSites || visitedFunctions.has(owner)) return false;
        visitedFunctions.add(owner);
        const areAllCallSitesCovered = callSites.every((callSite) =>
          doesCompletionCoverAnchor(callSite, visitedFunctions),
        );
        visitedFunctions.delete(owner);
        return areAllCallSitesCovered;
      }
      const anchorStart = getRangeStart(pathAnchor);
      return matchingCompletions.some((completion) => {
        const completionStart = getRangeStart(completion.coverageNode);
        return (
          anchorStart !== null &&
          completionStart !== null &&
          completionStart > anchorStart &&
          !isNodeConditionallyExecuted(completion.coverageNode, program)
        );
      });
    }
  };
  return doesCompletionCoverAnchor(mutation.node, new Set());
};

export const threeRequireInstancedBufferUpdate = defineRule({
  id: "three-require-instanced-buffer-update",
  title: "Three.js instanced mesh buffer is not marked for upload",
  category: "Correctness",
  severity: "error",
  recommendation:
    "After setMatrixAt, setColorAt, or setMorphAt, set the matching instance buffer's needsUpdate flag to true",
  create: (context: RuleContext) => {
    const mutations: DirectInstancedBufferMutation[] = [];
    const completions: DirectInstancedBufferCompletion[] = [];
    let program: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const completion = getInstancedBufferCompletion(node, context);
        if (completion) completions.push(completion);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const mutation = getInstancedBufferMutation(node, context);
        if (mutation) {
          mutations.push(mutation);
          return;
        }
        completions.push(...getOpaqueInstancedBufferCompletions(node, context));
      },
      "Program:exit"() {
        if (!program) return;
        for (const mutation of mutations) {
          if (isPreEscapeInitializationMutation(mutation, context)) continue;
          if (completionCoversMutation(mutation, completions, program, context)) continue;
          context.report({
            node: mutation.node,
            message: `After ${mutation.methodName}, set ${mutation.bufferPropertyName}.needsUpdate to true so Three.js uploads the changed instance data`,
          });
        }
      },
    };
  },
});
