import {
  EFFECT_HOOK_DEPENDENCY_ARGUMENT_COUNT,
  EFFECT_HOOK_DEPENDENCY_ARGUMENT_INDEX,
} from "../../constants/react.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectSynchronouslyInvokedLocalFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getValueImportSource } from "../../utils/get-value-import-declaration.js";
import { isBindingAssignmentTarget } from "../../utils/is-binding-assignment-target.js";
import { isErasedTypeScriptBinding } from "../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../utils/has-runtime-value-binding.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNonEscapingReactApiReference } from "../../utils/is-non-escaping-react-api-reference.js";
import { isTypeScriptTypePosition } from "../../utils/is-typescript-type-position.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

interface LocalHelperRenderOptions {
  readonly isExcludedInvocation: (
    call: EsTreeNodeOfType<"CallExpression">,
    renderOwner: EsTreeNode,
  ) => boolean;
}

const OPAQUE_PROVIDER_GLOBALS = new Set([
  "Object",
  "Reflect",
  "Function",
  "eval",
  "require",
  "module",
  "process",
  "globalThis",
  "window",
  "global",
  "self",
]);

export const findLocalHelperRenderOwner = (
  createRefCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  options: LocalHelperRenderOptions,
): EsTreeNode | null => {
  const allocatingFunction = findEnclosingFunction(createRefCall);
  const renderOwner = allocatingFunction ? findEnclosingFunction(allocatingFunction) : null;
  if (
    !isFunctionLike(allocatingFunction) ||
    !isFunctionLike(renderOwner) ||
    !isNodeOfType(renderOwner.body, "BlockStatement") ||
    !componentOrHookDisplayNameForFunction(renderOwner) ||
    isTestlikeFilename(context.filename)
  )
    return null;
  const callee = stripParenExpression(createRefCall.callee);
  if (createRefCall.optional) return null;
  const calleeRoot = getRootIdentifier(callee);
  const apiSymbol = calleeRoot ? context.scopes.symbolFor(calleeRoot) : null;
  if (!apiSymbol || getValueImportSource(apiSymbol) !== "react") return null;
  const isProvider = (symbol: SymbolDescriptor): boolean =>
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    getImportedName(symbol.declarationNode) === "default";
  const isFinitePrimitive = (expression: EsTreeNode): boolean =>
    isNodeOfType(expression, "Literal") &&
    !("regex" in expression) &&
    !("bigint" in expression) &&
    (expression.value === null ||
      typeof expression.value === "string" ||
      typeof expression.value === "boolean" ||
      (typeof expression.value === "number" && Number.isFinite(expression.value)));
  if (isNodeOfType(callee, "Identifier")) {
    if (getImportedName(apiSymbol.declarationNode) !== "createRef") return null;
  } else if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    stripParenExpression(callee.object) !== calleeRoot ||
    getStaticPropertyName(callee) !== "createRef" ||
    !isProvider(apiSymbol)
  )
    return null;
  for (const symbol of context.scopes.rootScope.symbols) {
    if (getValueImportSource(symbol) !== "react") continue;
    const importedName = getImportedName(symbol.declarationNode);
    if (!isProvider(symbol) && importedName !== "createRef" && importedName !== "useEffect")
      continue;
    if (
      !symbol.references.every((reference) => {
        if (isTypeScriptTypePosition(reference.identifier)) return true;
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier))
          return false;
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        if (!isProvider(symbol)) {
          if (importedName !== "useEffect") return isNonEscapingReactApiReference(referenceRoot);
          const call = referenceRoot.parent;
          return (
            isNodeOfType(call, "CallExpression") && call.callee === referenceRoot && !call.optional
          );
        }
        const member = referenceRoot.parent;
        if (!isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot)
          return false;
        const property = getStaticPropertyName(member);
        return (
          property !== null &&
          property !== "default" &&
          ((property !== "createRef" && property !== "useEffect") ||
            (!isMemberMutationTarget(member) && isNonEscapingReactApiReference(member)))
        );
      })
    )
      return null;
  }

  let hasProviderHazard = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (hasProviderHazard) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      OPAQUE_PROVIDER_GLOBALS.has(node.name) &&
      !isTypeScriptTypePosition(node)
    ) {
      const providerSymbol = context.scopes.symbolFor(node);
      if (
        providerSymbol &&
        context.scopes.referenceFor(node) &&
        isErasedTypeScriptBinding(providerSymbol) &&
        !hasRuntimeValueBinding(providerSymbol)
      ) {
        hasProviderHazard = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      (isNodeOfType(node, "Identifier") &&
        !isTypeScriptTypePosition(node) &&
        context.scopes.isGlobalReference(node) &&
        OPAQUE_PROVIDER_GLOBALS.has(node.name)) ||
      (isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "constructor")
    )
      hasProviderHazard = true;
    if (!isNodeOfType(node, "MemberExpression") || !isMemberMutationTarget(node)) return;
    const receiver = getRootIdentifier(node.object);
    const receiverSymbol = receiver ? context.scopes.symbolFor(receiver) : null;
    if (receiverSymbol && getValueImportSource(receiverSymbol) === "react") {
      const assignment = findTransparentExpressionRoot(node).parent;
      if (
        getStaticPropertyName(node) === null ||
        getStaticPropertyName(node) === "createRef" ||
        getStaticPropertyName(node) === "useEffect" ||
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.operator !== "=" ||
        !isFinitePrimitive(stripParenExpression(assignment.right))
      )
        hasProviderHazard = true;
    }
  });
  if (hasProviderHazard) return null;

  const valueRoot = findTransparentExpressionRoot(createRefCall);
  const declaration = valueRoot.parent;
  const valueSymbol =
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.init === valueRoot &&
    isNodeOfType(declaration.id, "Identifier")
      ? context.scopes.symbolFor(declaration.id)
      : null;
  const escapesAsArgument = (reference: EsTreeNode): boolean => {
    const expression = findTransparentExpressionRoot(reference);
    const call = expression.parent;
    return (
      isNodeOfType(call, "CallExpression") &&
      call.arguments.some((argument) => argument === expression) &&
      findEnclosingFunction(call) === allocatingFunction
    );
  };
  if (
    !escapesAsArgument(createRefCall) &&
    !(
      valueSymbol?.kind === "const" &&
      valueSymbol.references.every(
        (reference) =>
          reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
      ) &&
      valueSymbol.references.some((reference) => escapesAsArgument(reference.identifier))
    )
  )
    return null;

  const candidates = collectSynchronouslyInvokedLocalFunctions(renderOwner, context.scopes);
  const acceptedFunctions = new Set<EsTreeNode>();
  const activeFunctions = new Set<EsTreeNode>();
  const isValueParameter = (parameter: EsTreeNode): boolean => {
    if (!isNodeOfType(parameter, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(parameter);
    return Boolean(
      symbol &&
      symbol.references.every((reference) => {
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier))
          return false;
        let expression = findTransparentExpressionRoot(reference.identifier);
        if (isNodeOfType(expression.parent, "TemplateLiteral")) expression = expression.parent;
        return (
          isNodeOfType(expression.parent, "JSXExpressionContainer") &&
          (isNodeOfType(expression.parent.parent, "JSXAttribute") ||
            isNodeOfType(expression.parent.parent, "JSXElement") ||
            isNodeOfType(expression.parent.parent, "JSXFragment"))
        );
      }),
    );
  };
  const finalRootStatement = renderOwner.body.body.at(-1);
  let hasUnsupportedRootExit = false;
  walkAst(renderOwner.body, (node) => {
    if (isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "ThrowStatement") ||
      (isNodeOfType(node, "ReturnStatement") && finalRootStatement !== node)
    )
      hasUnsupportedRootExit = true;
  });
  if (hasUnsupportedRootExit) return null;
  const isNativeEffectDependencyArray = (array: EsTreeNode | null | undefined): boolean => {
    if (!isNodeOfType(array, "ArrayExpression")) return false;
    const call = array.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== EFFECT_HOOK_DEPENDENCY_ARGUMENT_COUNT ||
      call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
      call.arguments[EFFECT_HOOK_DEPENDENCY_ARGUMENT_INDEX] !== array ||
      findEnclosingFunction(call) !== renderOwner ||
      !array.elements.every((element) => element && !isNodeOfType(element, "SpreadElement"))
    )
      return false;
    const callee = stripParenExpression(call.callee);
    if (!isNodeOfType(callee, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(callee);
    return Boolean(
      symbol &&
      getValueImportSource(symbol) === "react" &&
      getImportedName(symbol.declarationNode) === "useEffect",
    );
  };
  const isClosedInputSymbol = (symbol: SymbolDescriptor): boolean => {
    if (
      symbol.references.some((reference) => {
        if (isTypeScriptTypePosition(reference.identifier)) return false;
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier))
          return true;
        const expression = findTransparentExpressionRoot(reference.identifier);
        let projectedValue = expression;
        while (
          isNodeOfType(projectedValue.parent, "MemberExpression") &&
          projectedValue.parent.object === projectedValue
        )
          projectedValue = findTransparentExpressionRoot(projectedValue.parent);
        const projectedParent = projectedValue.parent;
        if (isNativeEffectDependencyArray(projectedParent)) return false;
        if (
          (isNodeOfType(projectedParent, "VariableDeclarator") &&
            projectedParent.init === projectedValue) ||
          ((isNodeOfType(projectedParent, "AssignmentExpression") ||
            isNodeOfType(projectedParent, "AssignmentPattern")) &&
            projectedParent.right === projectedValue) ||
          isNodeOfType(projectedParent, "ArrayExpression") ||
          (isNodeOfType(projectedParent, "Property") && projectedParent.value === projectedValue)
        )
          return true;
        const parent = expression.parent;
        return (
          !(isNodeOfType(parent, "MemberExpression") && parent.object === expression) &&
          !isNodeOfType(parent, "IfStatement") &&
          !isNodeOfType(parent, "ConditionalExpression") &&
          !isNodeOfType(parent, "BinaryExpression") &&
          !(isNodeOfType(parent, "UnaryExpression") && parent.operator === "!")
        );
      })
    )
      return false;
    let hasMemberMutation = false;
    walkAst(renderOwner.body, (node) => {
      if (!isNodeOfType(node, "MemberExpression") || !isMemberMutationTarget(node)) return;
      const receiver = getRootIdentifier(node.object);
      if (receiver && context.scopes.symbolFor(receiver)?.id === symbol.id)
        hasMemberMutation = true;
    });
    return !hasMemberMutation;
  };
  const isRootInput = (rawExpression: EsTreeNode): boolean => {
    let expression = stripParenExpression(rawExpression);
    while (isNodeOfType(expression, "MemberExpression")) {
      if (expression.computed) return false;
      expression = stripParenExpression(expression.object);
    }
    if (!isNodeOfType(expression, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(expression);
    if (!symbol || !isClosedInputSymbol(symbol)) return false;
    if (symbol.kind === "parameter")
      return findEnclosingFunction(symbol.bindingIdentifier) === renderOwner;
    const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
    if (symbol.kind !== "const" || !isNodeOfType(initializer, "CallExpression")) return false;
    const origin = getRootIdentifier(initializer.callee);
    const originSymbol = origin ? context.scopes.symbolFor(origin) : null;
    return Boolean(
      originSymbol?.kind === "parameter" &&
      findEnclosingFunction(originSymbol.bindingIdentifier) === renderOwner &&
      isClosedInputSymbol(originSymbol),
    );
  };
  const isSupportedRootCondition = (rawCondition: EsTreeNode): boolean => {
    const condition = stripParenExpression(rawCondition);
    if (isNodeOfType(condition, "UnaryExpression") && condition.operator === "!")
      return isRootInput(condition.argument);
    if (isRootInput(condition)) return true;
    return (
      isNodeOfType(condition, "BinaryExpression") &&
      ["===", "!==", "==", "!=", "<", "<=", ">", ">="].includes(condition.operator) &&
      ((isRootInput(condition.left) && isFinitePrimitive(condition.right)) ||
        (isFinitePrimitive(condition.left) && isRootInput(condition.right)))
    );
  };
  const isSupportedLoop = (loop: EsTreeNodeOfType<"ForStatement">): boolean => {
    if (!isNodeOfType(loop.init, "VariableDeclaration")) return false;
    const [declaration, ...additionalDeclarations] = loop.init.declarations;
    if (
      additionalDeclarations.length > 0 ||
      !declaration ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !declaration.init ||
      !isNodeOfType(declaration.init, "Literal") ||
      typeof declaration.init.value !== "number" ||
      !Number.isFinite(declaration.init.value)
    )
      return false;
    const counter = context.scopes.symbolFor(declaration.id);
    const condition = loop.test ? stripParenExpression(loop.test) : null;
    const update = loop.update ? stripParenExpression(loop.update) : null;
    if (
      !counter ||
      !isNodeOfType(condition, "BinaryExpression") ||
      (condition.operator !== "<" && condition.operator !== "<=") ||
      !isNodeOfType(condition.left, "Identifier") ||
      context.scopes.symbolFor(condition.left)?.id !== counter.id ||
      !isNodeOfType(update, "UpdateExpression") ||
      update.operator !== "++" ||
      !isNodeOfType(update.argument, "Identifier") ||
      context.scopes.symbolFor(update.argument)?.id !== counter.id
    )
      return false;
    if (
      counter.references.some(
        (reference) => reference.flag !== "read" && reference.identifier !== update.argument,
      )
    )
      return false;
    let bound = stripParenExpression(condition.right);
    if (isNodeOfType(bound, "BinaryExpression") && bound.operator === "-") {
      if (
        !isNodeOfType(bound.right, "Literal") ||
        typeof bound.right.value !== "number" ||
        !Number.isFinite(bound.right.value)
      )
        return false;
      bound = stripParenExpression(bound.left);
    }
    if (
      !isNodeOfType(bound, "MemberExpression") ||
      bound.computed ||
      getStaticPropertyName(bound) !== "length" ||
      !isRootInput(bound)
    )
      return false;
    let unsupportedBody = false;
    walkAst(loop.body, (node) => {
      if (isFunctionLike(node)) return false;
      if (
        isNodeOfType(node, "BreakStatement") ||
        isNodeOfType(node, "ContinueStatement") ||
        isNodeOfType(node, "ReturnStatement") ||
        isNodeOfType(node, "ThrowStatement") ||
        isNodeOfType(node, "TryStatement") ||
        isNodeOfType(node, "LabeledStatement")
      )
        unsupportedBody = true;
    });
    return !unsupportedBody;
  };
  const isSupportedCall = (
    call: EsTreeNodeOfType<"CallExpression">,
    caller: EsTreeNode,
  ): boolean => {
    if (
      !isNodeReachableWithinFunction(call, context) ||
      options.isExcludedInvocation(call, renderOwner)
    )
      return false;
    let child: EsTreeNode = call;
    let hasConditionalAncestor = false;
    let hasLoopAncestor = false;
    for (let parent = call.parent; parent && parent !== caller; parent = parent.parent) {
      if (
        isNodeOfType(parent, "TryStatement") ||
        isNodeOfType(parent, "SwitchStatement") ||
        isNodeOfType(parent, "LabeledStatement") ||
        isNodeOfType(parent, "ClassDeclaration") ||
        isNodeOfType(parent, "ClassExpression") ||
        isNodeOfType(parent, "StaticBlock")
      )
        return false;
      if (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) {
        if (
          hasConditionalAncestor ||
          child === parent.test ||
          caller !== renderOwner ||
          !isSupportedRootCondition(parent.test)
        )
          return false;
        hasConditionalAncestor = true;
      }
      if (isNodeOfType(parent, "LogicalExpression")) return false;
      if (isNodeOfType(parent, "ForStatement")) {
        if (
          hasConditionalAncestor ||
          hasLoopAncestor ||
          child !== parent.body ||
          caller !== renderOwner ||
          !isSupportedLoop(parent)
        )
          return false;
        hasLoopAncestor = true;
      }
      if (
        isNodeOfType(parent, "ForOfStatement") ||
        isNodeOfType(parent, "ForInStatement") ||
        isNodeOfType(parent, "WhileStatement") ||
        isNodeOfType(parent, "DoWhileStatement")
      )
        return false;
      child = parent;
    }
    return true;
  };
  const proveHelper = (functionNode: EsTreeNode): boolean => {
    if (acceptedFunctions.has(functionNode)) return true;
    if (
      activeFunctions.has(functionNode) ||
      !candidates.has(functionNode) ||
      !isNodeOfType(functionNode, "ArrowFunctionExpression") ||
      functionNode.async ||
      functionNode.generator ||
      !functionNode.params.every(isValueParameter)
    )
      return false;
    const expression = findTransparentExpressionRoot(functionNode);
    const binding = expression.parent;
    if (
      !isNodeOfType(binding, "VariableDeclarator") ||
      binding.init !== expression ||
      !isNodeOfType(binding.id, "Identifier") ||
      !isNodeOfType(binding.parent, "VariableDeclaration") ||
      binding.parent.kind !== "const" ||
      binding.parent.parent !== renderOwner.body
    )
      return false;
    const symbol: SymbolDescriptor | null = context.scopes.symbolFor(binding.id) ?? null;
    if (!symbol || symbol.references.length === 0) return false;
    let unsupportedBody = false;
    walkAst(functionNode.body, (node) => {
      if (isFunctionLike(node)) {
        unsupportedBody = true;
        return false;
      }
      if (
        isNodeOfType(node, "IfStatement") ||
        isNodeOfType(node, "ConditionalExpression") ||
        isNodeOfType(node, "LogicalExpression") ||
        isNodeOfType(node, "TryStatement") ||
        isNodeOfType(node, "SwitchStatement") ||
        isNodeOfType(node, "ForStatement") ||
        isNodeOfType(node, "ForOfStatement") ||
        isNodeOfType(node, "ForInStatement") ||
        isNodeOfType(node, "WhileStatement") ||
        isNodeOfType(node, "DoWhileStatement") ||
        isNodeOfType(node, "AwaitExpression") ||
        isNodeOfType(node, "ThrowStatement") ||
        isNodeOfType(node, "LabeledStatement") ||
        isNodeOfType(node, "BreakStatement") ||
        isNodeOfType(node, "ContinueStatement") ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression") ||
        isNodeOfType(node, "StaticBlock") ||
        isNodeOfType(node, "ThisExpression") ||
        (isNodeOfType(node, "Identifier") &&
          node.name === "arguments" &&
          context.scopes.isGlobalReference(node))
      )
        unsupportedBody = true;
      if (
        isNodeOfType(node, "ReturnStatement") &&
        (!isNodeOfType(functionNode.body, "BlockStatement") ||
          functionNode.body.body.at(-1) !== node)
      )
        unsupportedBody = true;
    });
    if (unsupportedBody) return false;
    activeFunctions.add(functionNode);
    const proven = symbol.references.every((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const call = referenceRoot.parent;
      if (
        reference.flag !== "read" ||
        isBindingAssignmentTarget(reference.identifier) ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== referenceRoot ||
        call.optional ||
        binding.range[1] > call.range[0]
      )
        return false;
      const caller = findEnclosingFunction(call);
      return Boolean(
        caller && isSupportedCall(call, caller) && (caller === renderOwner || proveHelper(caller)),
      );
    });
    activeFunctions.delete(functionNode);
    if (proven) acceptedFunctions.add(functionNode);
    return proven;
  };
  return proveHelper(allocatingFunction) ? renderOwner : null;
};
