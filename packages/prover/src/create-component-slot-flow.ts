import ts from "typescript";
import { REACT_TRANSPARENT_COMPONENT_NAMES } from "./constants.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getComponentPropName } from "./get-component-prop-name.js";
import { isComponentPropExpression } from "./is-component-prop-expression.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { getJsxComponentTargetFunction } from "./utils/get-jsx-component-target-function.js";
import { getJsxOpeningElementForAttribute } from "./utils/get-jsx-opening-element-for-attribute.js";
import { isIntrinsicJsxElement } from "./utils/is-intrinsic-jsx-element.js";

export interface ComponentSlotPlacementDescriptor {
  node: ts.Expression;
  ownerFunction: ts.FunctionLikeDeclaration;
  topologyFrames: ReadonlyArray<ComponentSlotTopologyFrame>;
}

export interface ComponentSlotTopologyFrame {
  node: ts.Expression;
  ownerFunction: ts.FunctionLikeDeclaration;
}

export interface ComponentSlotResolutionDescriptor {
  complete: boolean;
  placements: ReadonlyArray<ComponentSlotPlacementDescriptor>;
}

export interface ComponentSlotFlowDescriptor {
  resolveSlot(
    functionNode: ts.FunctionLikeDeclaration,
    propName: string,
  ): ComponentSlotResolutionDescriptor;
}

interface ComponentSlotChannel {
  functionNode: ts.FunctionLikeDeclaration;
  propName: string;
}

interface ComponentSlotReferenceClassification {
  complete: boolean;
  forwarding: ComponentSlotForwarding | null;
  ignored: boolean;
  placement: ComponentSlotPlacementDescriptor | null;
}

interface ComponentSlotForwarding {
  channel: ComponentSlotChannel;
  topologyFrame: ComponentSlotTopologyFrame;
}

const getNodeIdentity = (node: ts.Node): string =>
  `${node.getSourceFile().fileName}:${node.getStart()}:${node.getEnd()}`;

const getChannelIdentity = (channel: ComponentSlotChannel): string =>
  `${getNodeIdentity(channel.functionNode)}:${channel.propName}`;

const isTransparentOpeningElement = (
  openingElement: ts.JsxOpeningLikeElement,
  transparentOpeningElements: ReadonlySet<ts.JsxOpeningLikeElement>,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (isIntrinsicJsxElement(openingElement) || transparentOpeningElements.has(openingElement)) {
    return true;
  }
  const reactComponentName = ts.isJsxNamespacedName(openingElement.tagName)
    ? null
    : getCanonicalReactApiName(openingElement.tagName, typeChecker);
  return Boolean(reactComponentName && REACT_TRANSPARENT_COMPONENT_NAMES.has(reactComponentName));
};

const createUnknownClassification = (): ComponentSlotReferenceClassification => ({
  complete: false,
  forwarding: null,
  ignored: false,
  placement: null,
});

const createIgnoredClassification = (): ComponentSlotReferenceClassification => ({
  complete: true,
  forwarding: null,
  ignored: true,
  placement: null,
});

const createPlacementClassification = (
  node: ts.Expression,
  ownerFunction: ts.FunctionLikeDeclaration,
): ComponentSlotReferenceClassification => ({
  complete: true,
  forwarding: null,
  ignored: false,
  placement: {
    node,
    ownerFunction,
    topologyFrames: [{ node, ownerFunction }],
  },
});

const createForwardedClassification = (
  node: ts.Expression,
  ownerFunction: ts.FunctionLikeDeclaration,
  functionNode: ts.FunctionLikeDeclaration,
  propName: string,
): ComponentSlotReferenceClassification => ({
  complete: true,
  forwarding: {
    channel: { functionNode, propName },
    topologyFrame: { node, ownerFunction },
  },
  ignored: false,
  placement: null,
});

const isConditionExpression = (node: ts.Node, parentNode: ts.Node): boolean =>
  (ts.isIfStatement(parentNode) && parentNode.expression === node) ||
  (ts.isConditionalExpression(parentNode) && parentNode.condition === node) ||
  (ts.isWhileStatement(parentNode) && parentNode.expression === node) ||
  (ts.isDoStatement(parentNode) && parentNode.expression === node) ||
  (ts.isForStatement(parentNode) && parentNode.condition === node);

const classifySlotReference = (
  expression: ts.Expression,
  ownerFunction: ts.FunctionLikeDeclaration,
  unitFunctionsBySymbol: ReadonlyMap<ts.Symbol, ts.FunctionLikeDeclaration>,
  transparentOpeningElements: ReadonlySet<ts.JsxOpeningLikeElement>,
  typeChecker: ts.TypeChecker,
): ComponentSlotReferenceClassification => {
  let currentNode: ts.Node = expression;
  while (currentNode !== ownerFunction) {
    const parentNode = currentNode.parent;
    if (!parentNode) return createUnknownClassification();
    if (isConditionExpression(currentNode, parentNode)) return createIgnoredClassification();
    if (ts.isBinaryExpression(parentNode)) {
      if (
        parentNode.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        parentNode.left === currentNode
      ) {
        return createIgnoredClassification();
      }
      if (
        parentNode.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken &&
        parentNode.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
        parentNode.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
      ) {
        return createUnknownClassification();
      }
    }
    if (ts.isCallExpression(parentNode)) {
      const reactApiName = getCanonicalReactApiName(parentNode.expression, typeChecker);
      if (reactApiName === "createPortal" && parentNode.arguments[0] === currentNode) {
        currentNode = parentNode;
        continue;
      }
      if (
        (reactApiName === "isValidElement" || parentNode.expression.getText() === "Boolean") &&
        parentNode.arguments[0] === currentNode
      ) {
        return createIgnoredClassification();
      }
      return createUnknownClassification();
    }
    if (ts.isJsxAttribute(parentNode)) {
      const openingElement = getJsxOpeningElementForAttribute(parentNode);
      if (!openingElement) return createUnknownClassification();
      const propName = parentNode.name.getText();
      if (isTransparentOpeningElement(openingElement, transparentOpeningElements, typeChecker)) {
        return propName === "children"
          ? createPlacementClassification(expression, ownerFunction)
          : createUnknownClassification();
      }
      const targetFunction = getJsxComponentTargetFunction(
        openingElement,
        unitFunctionsBySymbol,
        typeChecker,
      );
      return targetFunction
        ? createForwardedClassification(expression, ownerFunction, targetFunction, propName)
        : createUnknownClassification();
    }
    if (ts.isJsxElement(parentNode)) {
      const openingElement = parentNode.openingElement;
      if (!isTransparentOpeningElement(openingElement, transparentOpeningElements, typeChecker)) {
        const targetFunction = getJsxComponentTargetFunction(
          openingElement,
          unitFunctionsBySymbol,
          typeChecker,
        );
        return targetFunction
          ? createForwardedClassification(expression, ownerFunction, targetFunction, "children")
          : createUnknownClassification();
      }
    }
    if (ts.isReturnStatement(parentNode) && parentNode.expression === currentNode) {
      return createPlacementClassification(expression, ownerFunction);
    }
    if (
      ts.isArrowFunction(ownerFunction) &&
      ownerFunction.body === currentNode &&
      ts.isExpression(ownerFunction.body)
    ) {
      return createPlacementClassification(expression, ownerFunction);
    }
    if (
      ts.isVariableDeclaration(parentNode) ||
      ts.isPropertyAssignment(parentNode) ||
      ts.isShorthandPropertyAssignment(parentNode) ||
      ts.isPropertyAccessExpression(parentNode) ||
      ts.isElementAccessExpression(parentNode) ||
      ts.isJsxSpreadAttribute(parentNode) ||
      ts.isNewExpression(parentNode) ||
      ts.isPrefixUnaryExpression(parentNode) ||
      ts.isPostfixUnaryExpression(parentNode) ||
      ts.isSpreadElement(parentNode) ||
      ts.isTaggedTemplateExpression(parentNode) ||
      ts.isTemplateExpression(parentNode) ||
      ts.isTemplateSpan(parentNode) ||
      ts.isExpressionStatement(parentNode) ||
      isFunctionBoundary(parentNode)
    ) {
      return createUnknownClassification();
    }
    currentNode = parentNode;
  }
  return createUnknownClassification();
};

const deduplicatePlacements = (
  placements: ReadonlyArray<ComponentSlotPlacementDescriptor>,
): ReadonlyArray<ComponentSlotPlacementDescriptor> => {
  const placementsByIdentity = new Map<string, ComponentSlotPlacementDescriptor>();
  for (const placement of placements) {
    placementsByIdentity.set(
      placement.topologyFrames
        .map(
          (topologyFrame) =>
            `${getNodeIdentity(topologyFrame.ownerFunction)}:${getNodeIdentity(topologyFrame.node)}`,
        )
        .join(">"),
      placement,
    );
  }
  return [...placementsByIdentity.values()];
};

export const createComponentSlotFlow = (
  componentFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>,
  unitFunctionsBySymbol: ReadonlyMap<ts.Symbol, ts.FunctionLikeDeclaration>,
  transparentOpeningElements: ReadonlySet<ts.JsxOpeningLikeElement>,
  typeChecker: ts.TypeChecker,
): ComponentSlotFlowDescriptor => {
  const placementsByChannel = new Map<string, ComponentSlotPlacementDescriptor[]>();
  const forwardingsByChannel = new Map<string, ComponentSlotForwarding[]>();
  const incompleteChannelIds = new Set<string>();
  const incompleteFunctionIds = new Set<string>();

  for (const ownerFunction of componentFunctions) {
    const visit = (node: ts.Node): void => {
      if (node !== ownerFunction && isFunctionBoundary(node)) return;
      const expression =
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node) ||
        (ts.isIdentifier(node) &&
          isIdentifierReference(node) &&
          !(
            (ts.isPropertyAccessExpression(node.parent) ||
              ts.isElementAccessExpression(node.parent)) &&
            node.parent.expression === node
          ))
          ? node
          : null;
      const propName = expression
        ? getComponentPropName(expression, ownerFunction, typeChecker)
        : null;
      if (expression && propName) {
        const channel: ComponentSlotChannel = { functionNode: ownerFunction, propName };
        const channelId = getChannelIdentity(channel);
        const classification = classifySlotReference(
          expression,
          ownerFunction,
          unitFunctionsBySymbol,
          transparentOpeningElements,
          typeChecker,
        );
        if (!classification.complete) incompleteChannelIds.add(channelId);
        if (classification.placement) {
          const placements = placementsByChannel.get(channelId) ?? [];
          placements.push(classification.placement);
          placementsByChannel.set(channelId, placements);
        }
        if (classification.forwarding) {
          const forwardings = forwardingsByChannel.get(channelId) ?? [];
          forwardings.push(classification.forwarding);
          forwardingsByChannel.set(channelId, forwardings);
        }
        if (classification.ignored) return;
      } else if (expression && isComponentPropExpression(expression, ownerFunction, typeChecker)) {
        incompleteFunctionIds.add(getNodeIdentity(ownerFunction));
      }
      node.forEachChild(visit);
    };
    ownerFunction.forEachChild(visit);
  }

  const resolveChannel = (
    channel: ComponentSlotChannel,
    resolvingChannelIds: ReadonlySet<string>,
  ): ComponentSlotResolutionDescriptor => {
    const channelId = getChannelIdentity(channel);
    if (resolvingChannelIds.has(channelId)) return { complete: false, placements: [] };
    const nextResolvingChannelIds = new Set(resolvingChannelIds);
    nextResolvingChannelIds.add(channelId);
    const placements = [...(placementsByChannel.get(channelId) ?? [])];
    let complete =
      !incompleteChannelIds.has(channelId) &&
      !incompleteFunctionIds.has(getNodeIdentity(channel.functionNode));
    for (const forwarding of forwardingsByChannel.get(channelId) ?? []) {
      const forwardedResolution = resolveChannel(forwarding.channel, nextResolvingChannelIds);
      placements.push(
        ...forwardedResolution.placements.map((placement) => ({
          ...placement,
          topologyFrames: [forwarding.topologyFrame, ...placement.topologyFrames],
        })),
      );
      complete = forwardedResolution.complete && complete;
    }
    return { complete, placements: deduplicatePlacements(placements) };
  };

  return {
    resolveSlot: (functionNode, propName) => resolveChannel({ functionNode, propName }, new Set()),
  };
};
