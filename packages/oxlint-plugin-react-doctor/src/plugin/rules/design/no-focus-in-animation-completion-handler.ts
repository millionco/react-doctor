import { defineRule } from "../../utils/define-rule.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveStaticJsxAttribute } from "../../utils/resolve-static-jsx-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const ANIMATION_COMPLETION_HANDLER_NAMES = [
  "onAnimationEnd",
  "onAnimationEndCapture",
  "onTransitionEnd",
  "onTransitionEndCapture",
];
const REACT_REF_CREATION_API_NAMES = new Set(["createRef", "useRef"]);

interface ProvenRenderLocation {
  owner: EsTreeNode;
  root: EsTreeNode;
}

interface IntrinsicReactRefAttachment {
  location: ProvenRenderLocation;
  node: EsTreeNodeOfType<"JSXOpeningElement">;
}

interface IntrinsicReactRefIndex {
  attachmentsBySymbolId: ReadonlyMap<number, ReadonlyArray<IntrinsicReactRefAttachment>>;
}

const isGeneratorFunction = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")) &&
  node.generator;

const isIntrinsicOpeningElement = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  isNodeOfType(node.name, "JSXIdentifier") && /^[a-z]/.test(node.name.name);

const getProvenRenderLocation = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): ProvenRenderLocation | null => {
  let current: EsTreeNode = openingElement;
  let didLeaveOwnElement = false;
  while (current.parent) {
    const transparentRoot = findTransparentExpressionRoot(current);
    if (transparentRoot !== current) {
      current = transparentRoot;
      continue;
    }
    const parent = current.parent;
    if (isNodeOfType(parent, "JSXElement")) {
      if (parent.openingElement === current) {
        didLeaveOwnElement = true;
      } else if (didLeaveOwnElement && !isIntrinsicOpeningElement(parent.openingElement)) {
        return null;
      }
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXFragment")) {
      current = parent;
      continue;
    }
    if (
      isNodeOfType(parent, "JSXExpressionContainer") &&
      parent.expression === current &&
      parent.parent &&
      !isNodeOfType(parent.parent, "JSXAttribute")
    ) {
      current = parent;
      continue;
    }
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.right === current || (parent.left === current && parent.operator !== "&&"))) ||
      (isNodeOfType(parent, "ArrayExpression") &&
        parent.elements.some((element) => element === current))
    ) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "SequenceExpression")) {
      if (parent.expressions.at(-1) !== current) return null;
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) {
      const owner = findEnclosingFunction(parent);
      return owner && !isGeneratorFunction(owner) ? { owner, root: parent } : null;
    }
    if (
      isNodeOfType(parent, "ArrowFunctionExpression") &&
      parent.body === current &&
      !parent.generator
    ) {
      return { owner: parent, root: parent };
    }
    return null;
  }
  return null;
};

const getStaticBooleanAttributeState = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean | null => {
  const attribute = hasJsxPropIgnoreCase(openingElement.attributes, attributeName);
  if (!attribute) return false;
  if (!attribute.value) return true;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  return isNodeOfType(expression, "Literal") && typeof expression.value === "boolean"
    ? expression.value
    : null;
};

const hasStaticallyHidingClassName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const classNameAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "className");
  if (!classNameAttribute?.value) return false;
  const className = getJsxPropStringValue(classNameAttribute);
  return Boolean(
    className &&
    splitTailwindClassName(className).some((token) => {
      const utility = token.split(":").at(-1)?.replace(/^!/, "").replace(/!$/, "");
      return utility === "hidden" || utility === "invisible" || utility === "collapse";
    }),
  );
};

const hasStaticallyHidingStyle = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const styleAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "style");
  if (
    !styleAttribute?.value ||
    !isNodeOfType(styleAttribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(styleAttribute.value.expression, "ObjectExpression")
  ) {
    return false;
  }
  for (const property of styleAttribute.value.expression.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    let propertyName: string | null = null;
    if (isNodeOfType(property.key, "Identifier")) {
      propertyName = property.key.name;
    } else if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
      propertyName = property.key.value;
    }
    const propertyValue =
      isNodeOfType(property.value, "Literal") && typeof property.value.value === "string"
        ? property.value.value
        : null;
    if (
      (propertyName === "display" && propertyValue === "none") ||
      (propertyName === "visibility" &&
        (propertyValue === "hidden" || propertyValue === "collapse")) ||
      (propertyName === "contentVisibility" && propertyValue === "hidden")
    ) {
      return true;
    }
  }
  return false;
};

const isStaticallyExcludedOpeningElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  isTarget: boolean,
): boolean => {
  const tagName = isNodeOfType(openingElement.name, "JSXIdentifier")
    ? openingElement.name.name
    : null;
  if (!tagName || !/^[a-z]/.test(tagName)) return true;
  const hiddenState = getStaticBooleanAttributeState(openingElement, "hidden");
  const inertState = getStaticBooleanAttributeState(openingElement, "inert");
  if (
    hiddenState !== false ||
    inertState !== false ||
    hasStaticallyHidingClassName(openingElement) ||
    hasStaticallyHidingStyle(openingElement) ||
    tagName === "template"
  ) {
    return true;
  }
  if (
    tagName === "fieldset" &&
    getStaticBooleanAttributeState(openingElement, "disabled") !== false
  ) {
    return true;
  }
  if (
    (tagName === "dialog" || tagName === "details") &&
    getStaticBooleanAttributeState(openingElement, "open") !== true
  ) {
    return true;
  }
  if (isTarget && tagName === "input") {
    const typeAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "type");
    if (typeAttribute && (!typeAttribute.value || getJsxPropStringValue(typeAttribute) === null)) {
      return true;
    }
  }
  return false;
};

const hasStaticallyExcludedAncestry = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  renderRoot: EsTreeNode,
): boolean => {
  if (isStaticallyExcludedOpeningElement(openingElement, true)) return true;
  let current: EsTreeNode = openingElement.parent ?? openingElement;
  while (current !== renderRoot && current.parent) {
    const parent = current.parent;
    if (
      isNodeOfType(parent, "JSXElement") &&
      parent.openingElement !== openingElement &&
      isStaticallyExcludedOpeningElement(parent.openingElement, false)
    ) {
      return true;
    }
    current = parent;
  }
  return false;
};

const getStaticTruthiness = (expression: EsTreeNode): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Literal")) {
    return Boolean(unwrappedExpression.value);
  }
  if (
    isNodeOfType(unwrappedExpression, "TemplateLiteral") &&
    unwrappedExpression.expressions.length === 0
  ) {
    return Boolean(unwrappedExpression.quasis[0]?.value.cooked);
  }
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const argumentTruthiness = getStaticTruthiness(unwrappedExpression.argument);
    return argumentTruthiness === null ? null : !argumentTruthiness;
  }
  return null;
};

const hasContradictoryBooleanRequirements = (
  expression: EsTreeNode,
  expectedTruthiness: boolean,
  context: RuleContext,
): boolean => {
  const requirements = new Map<number, boolean>();
  const collectRequirements = (candidate: EsTreeNode, requiredTruthiness: boolean): boolean => {
    const unwrappedCandidate = stripParenExpression(candidate);
    const staticTruthiness = getStaticTruthiness(unwrappedCandidate);
    if (staticTruthiness !== null) return staticTruthiness !== requiredTruthiness;
    if (
      isNodeOfType(unwrappedCandidate, "UnaryExpression") &&
      unwrappedCandidate.operator === "!"
    ) {
      return collectRequirements(unwrappedCandidate.argument, !requiredTruthiness);
    }
    if (
      isNodeOfType(unwrappedCandidate, "LogicalExpression") &&
      ((unwrappedCandidate.operator === "&&" && requiredTruthiness) ||
        (unwrappedCandidate.operator === "||" && !requiredTruthiness))
    ) {
      return (
        collectRequirements(unwrappedCandidate.left, requiredTruthiness) ||
        collectRequirements(unwrappedCandidate.right, requiredTruthiness)
      );
    }
    if (!isNodeOfType(unwrappedCandidate, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(unwrappedCandidate);
    if (!symbol) return false;
    const previousRequirement = requirements.get(symbol.id);
    if (previousRequirement !== undefined && previousRequirement !== requiredTruthiness) {
      return true;
    }
    requirements.set(symbol.id, requiredTruthiness);
    return false;
  };
  return collectRequirements(expression, expectedTruthiness);
};

const isInStaticallyImpossiblePath = (
  node: EsTreeNode,
  boundary: EsTreeNode,
  context: RuleContext,
): boolean => {
  let child = node;
  let parent = node.parent;
  while (parent && parent !== boundary) {
    if (isNodeOfType(parent, "SwitchCase")) return true;
    if (isNodeOfType(parent, "IfStatement")) {
      const expectedTruthiness = parent.consequent === child;
      if (
        (parent.consequent === child || parent.alternate === child) &&
        (getStaticTruthiness(parent.test) === !expectedTruthiness ||
          hasContradictoryBooleanRequirements(parent.test, expectedTruthiness, context))
      ) {
        return true;
      }
    } else if (isNodeOfType(parent, "ConditionalExpression")) {
      const expectedTruthiness = parent.consequent === child;
      if (
        (parent.consequent === child || parent.alternate === child) &&
        (getStaticTruthiness(parent.test) === !expectedTruthiness ||
          hasContradictoryBooleanRequirements(parent.test, expectedTruthiness, context))
      ) {
        return true;
      }
    } else if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) {
      const requiredTruthiness = parent.operator === "&&";
      if (
        parent.operator !== "??" &&
        (getStaticTruthiness(parent.left) === !requiredTruthiness ||
          hasContradictoryBooleanRequirements(parent.left, requiredTruthiness, context))
      ) {
        return true;
      }
    } else if (isNodeOfType(parent, "BlockStatement")) {
      let containingStatement = child;
      while (containingStatement.parent && containingStatement.parent !== parent) {
        containingStatement = containingStatement.parent;
      }
      const statementIndex = parent.body.findIndex(
        (statement) => statement === containingStatement,
      );
      if (
        statementIndex > 0 &&
        parent.body.slice(0, statementIndex).some((statement) => statementAlwaysExits(statement))
      ) {
        return true;
      }
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
};

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

const resolveHandlerExpression = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  handlerName: string,
): EsTreeNode | null => {
  const resolution = resolveStaticJsxAttribute(openingElement.attributes, handlerName);
  if (!resolution.isPresent || resolution.isUnknown) return null;
  return resolution.expression ?? getHandlerExpression(resolution.attribute ?? openingElement);
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

const isSafeDirectReactRefReference = (identifier: EsTreeNode, context: RuleContext): boolean => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  const parent = expressionRoot.parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === expressionRoot &&
    getStaticPropertyName(parent) === "current"
  ) {
    const currentRoot = findTransparentExpressionRoot(parent);
    const focusMember = currentRoot.parent;
    if (
      focusMember &&
      isNodeOfType(focusMember, "MemberExpression") &&
      focusMember.object === currentRoot &&
      getStaticPropertyName(focusMember) === "focus"
    ) {
      const focusRoot = findTransparentExpressionRoot(focusMember);
      return Boolean(
        focusRoot.parent &&
        isNodeOfType(focusRoot.parent, "CallExpression") &&
        focusRoot.parent.callee === focusRoot,
      );
    }
    return false;
  }
  if (
    parent &&
    isNodeOfType(parent, "ArrayExpression") &&
    parent.parent &&
    isNodeOfType(parent.parent, "CallExpression") &&
    parent.parent.arguments[1] === parent &&
    isReactApiCall(parent.parent, "useCallback", context.scopes, {
      resolveNamedAliases: true,
    })
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
  const attachmentsBySymbolId = new Map<number, IntrinsicReactRefAttachment[]>();
  const refSymbolsById = new Map<number, SymbolDescriptor>();
  const uncertainRefSymbolIds = new Set<number>();
  walkAst(program, (candidate) => {
    if (!isNodeOfType(candidate, "JSXOpeningElement")) return;
    if (!isNodeReachableWithinFunction(candidate, context)) return false;
    const renderLocation = getProvenRenderLocation(candidate);
    if (!renderLocation || isInStaticallyImpossiblePath(candidate, renderLocation.owner, context)) {
      return false;
    }
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
      isReactApiCall(initializer, REACT_REF_CREATION_API_NAMES, context.scopes, {
        resolveNamedAliases: true,
      })
    ) {
      refSymbolsById.set(refSymbol.id, refSymbol);
      const tagName = isNodeOfType(candidate.name, "JSXIdentifier") ? candidate.name.name : null;
      if (
        tagName &&
        /^[a-z]/.test(tagName) &&
        isFocusableJsxOpeningElement(candidate, tagName, true) &&
        !hasStaticallyExcludedAncestry(candidate, renderLocation.root)
      ) {
        const attachments = attachmentsBySymbolId.get(refSymbol.id) ?? [];
        attachments.push({ location: renderLocation, node: candidate });
        attachmentsBySymbolId.set(refSymbol.id, attachments);
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
        includeCreateRef: true,
        resolveNamedAliases: true,
      },
    );
    if (refSymbol) uncertainRefSymbolIds.add(refSymbol.id);
  });
  for (const [refSymbolId, refSymbol] of refSymbolsById) {
    if (
      refSymbol.references.some(
        (reference) => !isSafeDirectReactRefReference(reference.identifier, context),
      )
    ) {
      uncertainRefSymbolIds.add(refSymbolId);
    }
  }
  for (const uncertainRefSymbolId of uncertainRefSymbolIds) {
    attachmentsBySymbolId.delete(uncertainRefSymbolId);
  }
  return { attachmentsBySymbolId };
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

const isHandlerCurrentTarget = (
  expression: EsTreeNode,
  handler: EsTreeNode,
  context: RuleContext,
): boolean => {
  const currentTargetMember = stripParenExpression(expression);
  if (
    !isFunctionLike(handler) ||
    !isNodeOfType(currentTargetMember, "MemberExpression") ||
    getStaticPropertyName(currentTargetMember) !== "currentTarget"
  ) {
    return false;
  }
  const eventExpression = stripParenExpression(currentTargetMember.object);
  const eventParameter = handler.params[0];
  return Boolean(
    eventParameter &&
    isNodeOfType(eventParameter, "Identifier") &&
    isNodeOfType(eventExpression, "Identifier") &&
    context.scopes.symbolFor(eventParameter)?.id === context.scopes.symbolFor(eventExpression)?.id,
  );
};

const collectDirectFocusCalls = (
  handler: EsTreeNode,
  handlerSite: EsTreeNodeOfType<"JSXOpeningElement">,
  handlerRenderLocation: ProvenRenderLocation,
  intrinsicRefIndex: IntrinsicReactRefIndex,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression">[] => {
  if (!isFunctionLike(handler) || isGeneratorFunction(handler)) return [];
  const focusCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(handler.body, (child) => {
    if (
      isFunctionLike(child) &&
      (isGeneratorFunction(child) || !isImmediatelyInvokedFunction(child))
    ) {
      return false;
    }
    if (isNodeOfType(child, "PropertyDefinition") || isNodeOfType(child, "AccessorProperty")) {
      return false;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    if (
      !isNodeReachableWithinFunction(child, context) ||
      isInStaticallyImpossiblePath(child, handler, context)
    ) {
      return false;
    }
    const callee = stripParenExpression(child.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    if (getStaticPropertyName(callee) !== "focus") return;
    if (
      isHandlerCurrentTarget(callee.object, handler, context) &&
      isNodeOfType(handlerSite.name, "JSXIdentifier") &&
      isFocusableJsxOpeningElement(handlerSite, handlerSite.name.name, true) &&
      !hasStaticallyExcludedAncestry(handlerSite, handlerRenderLocation.root)
    ) {
      focusCalls.push(child);
      return;
    }
    const refSymbol = resolveReactRefSymbol(stripParenExpression(callee.object), context.scopes, {
      includeCreateRef: true,
      resolveNamedAliases: true,
    });
    const attachments = refSymbol
      ? intrinsicRefIndex.attachmentsBySymbolId.get(refSymbol.id)
      : null;
    if (
      attachments?.some(
        (attachment) =>
          attachment.location.owner === handlerRenderLocation.owner &&
          attachment.location.root === handlerRenderLocation.root &&
          nodesCanCoExecute(attachment.node, handler, context) &&
          nodesCanCoExecute(attachment.node, handlerSite, context) &&
          nodesCanCoExecute(attachment.node, child, context),
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
        if (!isIntrinsicOpeningElement(node)) return;
        const handlerRenderLocation = getProvenRenderLocation(node);
        if (
          !handlerRenderLocation ||
          isInStaticallyImpossiblePath(node, handlerRenderLocation.owner, context)
        ) {
          return;
        }
        for (const handlerName of ANIMATION_COMPLETION_HANDLER_NAMES) {
          const handlerExpression = resolveHandlerExpression(node, handlerName);
          if (!handlerExpression) continue;
          const handler = resolveReactCompletionHandler(handlerExpression, context);
          if (
            !handler ||
            !isNodeReachableWithinFunction(handlerExpression, context) ||
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
            node,
            handlerRenderLocation,
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
