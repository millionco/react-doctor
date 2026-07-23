import { defineRule } from "../../utils/define-rule.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import {
  resolveReactRefCurrentOriginSymbol,
  resolveReactRefSymbol,
} from "../../utils/react-ref-origin.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const ANIMATION_COMPLETION_HANDLER_NAMES = [
  "onAnimationEnd",
  "onAnimationEndCapture",
  "onTransitionEnd",
  "onTransitionEndCapture",
];

interface IntrinsicReactRefIndex {
  attachmentNodesBySymbolId: ReadonlyMap<
    number,
    ReadonlyArray<EsTreeNodeOfType<"JSXOpeningElement">>
  >;
}

const getHandlerExpression = (attribute: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
  ) {
    return null;
  }
  return attribute.value.expression;
};

const resolveReactCompletionHandler = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const directFunction = resolveExactLocalFunction(expression, context.scopes);
  if (directFunction) return directFunction;
  const unwrappedExpression = stripParenExpression(expression);
  const callbackSymbol = isNodeOfType(unwrappedExpression, "Identifier")
    ? resolveConstIdentifierAlias(unwrappedExpression, context.scopes)
    : null;
  const callbackInitializer = callbackSymbol?.kind === "const" ? callbackSymbol.initializer : null;
  const useCallbackCall = stripParenExpression(callbackInitializer ?? unwrappedExpression);
  if (
    !isNodeOfType(useCallbackCall, "CallExpression") ||
    !isReactApiCall(useCallbackCall, "useCallback", context.scopes, {
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  const wrappedCallback = useCallbackCall.arguments[0];
  if (!wrappedCallback || isNodeOfType(wrappedCallback, "SpreadElement")) return null;
  return resolveExactLocalFunction(wrappedCallback, context.scopes);
};

const isSafeDirectReactRefReference = (identifier: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  const parent = expressionRoot.parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === expressionRoot &&
    getStaticPropertyName(parent) === "current"
  ) {
    return true;
  }
  if (!parent || !isNodeOfType(parent, "JSXExpressionContainer")) return false;
  const attribute = parent.parent;
  return Boolean(
    attribute &&
    isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    attribute.name.name === "ref" &&
    attribute.value === parent,
  );
};

const collectIntrinsicReactRefIndex = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): IntrinsicReactRefIndex => {
  const attachmentNodesBySymbolId = new Map<number, EsTreeNodeOfType<"JSXOpeningElement">[]>();
  const refSymbolsById = new Map<number, SymbolDescriptor>();
  const uncertainRefSymbolIds = new Set<number>();
  walkAst(program, (candidate) => {
    if (!isNodeOfType(candidate, "JSXOpeningElement")) return;
    if (!isNodeReachableWithinFunction(candidate, context)) return false;
    if (hasJsxSpreadAttribute(candidate.attributes)) return false;
    const refAttribute = getAuthoritativeJsxAttribute(candidate.attributes, "ref");
    if (
      !refAttribute?.value ||
      !isNodeOfType(refAttribute.value, "JSXExpressionContainer") ||
      !isNodeOfType(refAttribute.value.expression, "Identifier")
    ) {
      return;
    }
    const refSymbol = context.scopes.symbolFor(refAttribute.value.expression);
    if (
      !refSymbol?.initializer ||
      refSymbol.kind !== "const" ||
      !isNodeOfType(refSymbol.declarationNode, "VariableDeclarator") ||
      refSymbol.declarationNode.id !== refSymbol.bindingIdentifier ||
      refSymbol.references.some((reference) => reference.flag !== "read")
    ) {
      return;
    }
    const initializer = stripParenExpression(refSymbol.initializer);
    if (
      isNodeOfType(initializer, "CallExpression") &&
      isReactApiCall(initializer, "useRef", context.scopes, { resolveNamedAliases: true })
    ) {
      refSymbolsById.set(refSymbol.id, refSymbol);
      if (
        isNodeOfType(candidate.name, "JSXIdentifier") &&
        /^[a-z]/.test(candidate.name.name) &&
        isFocusableJsxOpeningElement(candidate, candidate.name.name, true)
      ) {
        const attachmentNodes = attachmentNodesBySymbolId.get(refSymbol.id) ?? [];
        attachmentNodes.push(candidate);
        attachmentNodesBySymbolId.set(refSymbol.id, attachmentNodes);
      } else {
        uncertainRefSymbolIds.add(refSymbol.id);
      }
    }
  });
  walkAst(program, (candidate) => {
    let assignmentTarget: EsTreeNode | null = null;
    if (isNodeOfType(candidate, "AssignmentExpression")) {
      assignmentTarget = candidate.left;
    } else if (
      isNodeOfType(candidate, "UpdateExpression") ||
      (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "delete")
    ) {
      assignmentTarget = candidate.argument;
    }
    if (!assignmentTarget) return;
    const refSymbol = resolveReactRefSymbol(
      stripParenExpression(assignmentTarget),
      context.scopes,
      {
        resolveNamedAliases: true,
      },
    );
    if (refSymbol) uncertainRefSymbolIds.add(refSymbol.id);
  });
  for (const [refSymbolId, refSymbol] of refSymbolsById) {
    if (
      refSymbol?.references.some(
        (reference) => !isSafeDirectReactRefReference(reference.identifier),
      )
    ) {
      uncertainRefSymbolIds.add(refSymbolId);
    }
  }
  for (const uncertainRefSymbolId of uncertainRefSymbolIds) {
    attachmentNodesBySymbolId.delete(uncertainRefSymbolId);
  }
  return { attachmentNodesBySymbolId };
};

const isHandlerDefinitionReachable = (handler: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeReachableWithinFunction(handler.parent ?? handler, context)) return false;
  const outerFunction = findEnclosingFunction(handler);
  if (!outerFunction) return true;
  if (
    isNodeOfType(handler, "FunctionDeclaration") &&
    isFunctionLike(outerFunction) &&
    isNodeOfType(outerFunction.body, "BlockStatement") &&
    handler.parent === outerFunction.body
  ) {
    return true;
  }
  const outerCfg = context.cfg.cfgFor(outerFunction);
  const targetBlock = outerCfg?.blockOf(handler);
  if (!outerCfg || !targetBlock) return true;
  const reachableBlocks = new Set([outerCfg.entry]);
  const pendingBlocks = [outerCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (currentBlock === targetBlock) return true;
    for (const edge of currentBlock.successors) {
      if (reachableBlocks.has(edge.to)) continue;
      reachableBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const collectDirectFocusCalls = (
  handler: EsTreeNode,
  handlerSite: EsTreeNode,
  intrinsicRefIndex: IntrinsicReactRefIndex,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression">[] => {
  if (!isFunctionLike(handler)) return [];
  const focusCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(handler.body, (child) => {
    if (isFunctionLike(child) && !isImmediatelyInvokedFunction(child)) return false;
    if (isNodeOfType(child, "PropertyDefinition") || isNodeOfType(child, "AccessorProperty")) {
      return false;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeReachableWithinFunction(child, context)) return false;
    const callee = stripParenExpression(child.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    if (getStaticPropertyName(callee) !== "focus") return;
    const refSymbol = resolveReactRefCurrentOriginSymbol(callee.object, context.scopes);
    const attachmentNodes = refSymbol
      ? intrinsicRefIndex.attachmentNodesBySymbolId.get(refSymbol.id)
      : null;
    if (
      attachmentNodes?.some(
        (attachmentNode) =>
          nodesCanCoExecute(attachmentNode, handler, context) &&
          nodesCanCoExecute(attachmentNode, handlerSite, context),
      )
    ) {
      focusCalls.push(child);
    }
  });
  return focusCalls;
};

export const noFocusInAnimationCompletionHandler = defineRule({
  id: "no-focus-in-animation-completion-handler",
  title: "Focus waits for animation completion",
  severity: "warn",
  category: "Accessibility",
  tags: ["react-jsx-only"],
  recommendation:
    "Move focus when the interaction state changes, independently of visual animation completion, so canceled or reduced animations cannot delay or suppress keyboard focus.",
  create: (context: RuleContext) => {
    const intrinsicRefIndexesByProgram = new WeakMap<EsTreeNode, IntrinsicReactRefIndex>();
    const reportedFocusCalls = new WeakSet<EsTreeNode>();
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier") || !/^[a-z]/.test(node.name.name)) {
          return;
        }
        for (const handlerName of ANIMATION_COMPLETION_HANDLER_NAMES) {
          const attribute = getAuthoritativeJsxAttribute(node.attributes, handlerName);
          if (!attribute) continue;
          const handlerExpression = getHandlerExpression(attribute);
          if (!handlerExpression) continue;
          const handler = resolveReactCompletionHandler(handlerExpression, context);
          if (
            !handler ||
            !isNodeReachableWithinFunction(attribute, context) ||
            !isHandlerDefinitionReachable(handler, context)
          ) {
            continue;
          }
          const program = findProgramRoot(node);
          if (!program) continue;
          let intrinsicRefIndex = intrinsicRefIndexesByProgram.get(program);
          if (!intrinsicRefIndex) {
            intrinsicRefIndex = collectIntrinsicReactRefIndex(program, context);
            intrinsicRefIndexesByProgram.set(program, intrinsicRefIndex);
          }
          for (const focusCall of collectDirectFocusCalls(
            handler,
            attribute,
            intrinsicRefIndex,
            context,
          )) {
            if (reportedFocusCalls.has(focusCall)) continue;
            reportedFocusCalls.add(focusCall);
            context.report({
              node: focusCall,
              message: `This ${handlerName} handler moves focus after visual completion. Completion events can be skipped when animation is canceled, reduced, or removed; move focus when the interaction state changes instead.`,
            });
          }
        }
      },
    };
  },
});
