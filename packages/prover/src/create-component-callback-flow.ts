import ts from "typescript";
import { REACT_EVENT_PROP_PATTERN } from "./constants.js";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { getComponentPropName } from "./get-component-prop-name.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isComponentPropExpression } from "./is-component-prop-expression.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { mergeCallableBindings, resolveCallableExpression } from "./resolve-callable-expression.js";
import { ReactExecutionPhase } from "./types.js";
import type {
  ResolvedCallableGuardDescriptor,
  ResolvedCallableValueDescriptor,
} from "./resolve-callable-expression.js";

export interface ComponentCallbackDescriptor {
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>;
  callbackFunction: ts.FunctionLikeDeclaration;
  guards: ReadonlyArray<ResolvedCallableGuardDescriptor>;
  ownerFunction: ts.FunctionLikeDeclaration;
}

export interface ComponentEventBindingDescriptor {
  callbacks: ReadonlyArray<ComponentCallbackDescriptor>;
  eventName: string;
  isComplete: boolean;
  node: ts.JsxAttribute;
  ownerFunction: ts.FunctionLikeDeclaration;
}

export interface ComponentCallbackPropFlowDescriptor {
  callbacks: ReadonlyArray<ComponentCallbackDescriptor>;
  isComplete: boolean;
  node: ts.JsxAttribute;
  phase: ReactExecutionPhase;
  propName: string;
  renderNode: ts.JsxOpeningLikeElement;
  renderOwnerFunction: ts.FunctionLikeDeclaration;
  targetFunction: ts.FunctionLikeDeclaration;
}

export interface ComponentCallbackFlowDescriptor {
  bindings: ReadonlyArray<ComponentEventBindingDescriptor>;
  collectPropFlows(): ReadonlyArray<ComponentCallbackPropFlowDescriptor>;
  resolveCallback(
    callbackFunction: ts.FunctionLikeDeclaration,
    ownerFunction: ts.FunctionLikeDeclaration,
    phase: ReactExecutionPhase,
  ): ComponentCallbackResolutionDescriptor;
  resolveExpression(
    expression: ts.Expression,
    ownerFunction: ts.FunctionLikeDeclaration,
    phase: ReactExecutionPhase,
  ): ComponentCallbackExpressionResolutionDescriptor;
}

export interface ComponentCallbackResolutionDescriptor {
  bindings: ReadonlyMap<ts.Symbol, ResolvedCallableValueDescriptor>;
}

export interface ComponentCallbackExpressionResolutionDescriptor {
  callbacks: ReadonlyArray<ComponentCallbackDescriptor>;
  isComplete: boolean;
}

interface ComponentPropChannel {
  functionNode: ts.FunctionLikeDeclaration;
  propName: string;
}

interface ComponentPropBinding {
  callbacks: ReadonlyArray<ComponentCallbackDescriptor>;
  isComplete: boolean;
  node: ts.JsxAttribute;
  renderNode: ts.JsxOpeningLikeElement;
  renderOwnerFunction: ts.FunctionLikeDeclaration;
  sourceChannel: ComponentPropChannel | null;
  targetChannel: ComponentPropChannel;
  targetFunction: ts.FunctionLikeDeclaration;
}

interface CallbackSource {
  callbacks: ReadonlyArray<ComponentCallbackDescriptor>;
  channel: ComponentPropChannel | null;
  isComplete: boolean;
}

interface ResolvedCallbackSource {
  callbacks: ReadonlyArray<ComponentCallbackDescriptor>;
  isComplete: boolean;
}

interface ComponentPropReference {
  channel: ComponentPropChannel | null;
  isComplete: boolean;
  propertyName: string | null;
  symbol: ts.Symbol;
}

const getNodeIdentity = (node: ts.Node): string =>
  `${node.getSourceFile().fileName}:${node.getStart()}:${node.getEnd()}`;

const getSymbolIdentity = (symbol: ts.Symbol): string => {
  const declaration = symbol.declarations?.[0];
  return declaration ? getNodeIdentity(declaration) : symbol.getName();
};

const getChannelIdentity = (channel: ComponentPropChannel): string =>
  `${getNodeIdentity(channel.functionNode)}:${channel.propName}`;

const getJsxAttributeExpression = (attribute: ts.JsxAttribute): ts.Expression | null =>
  attribute.initializer &&
  ts.isJsxExpression(attribute.initializer) &&
  attribute.initializer.expression
    ? attribute.initializer.expression
    : null;

const getComponentPropChannel = (
  expression: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ComponentPropChannel | null => {
  const propName = getComponentPropName(expression, functionNode, typeChecker);
  return propName ? { functionNode, propName } : null;
};

const getOpeningElement = (node: ts.Node): ts.JsxOpeningLikeElement | null => {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return node;
  return null;
};

const getTargetFunction = (
  openingElement: ts.JsxOpeningLikeElement,
  unitFunctionsBySymbol: ReadonlyMap<ts.Symbol, ts.FunctionLikeDeclaration>,
  typeChecker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | null => {
  const directSymbol = typeChecker.getSymbolAtLocation(openingElement.tagName);
  if (!directSymbol) return null;
  const targetSymbol =
    directSymbol.flags & ts.SymbolFlags.Alias
      ? typeChecker.getAliasedSymbol(directSymbol)
      : directSymbol;
  return unitFunctionsBySymbol.get(targetSymbol) ?? null;
};

const isIntrinsicElement = (openingElement: ts.JsxOpeningLikeElement): boolean =>
  ts.isIdentifier(openingElement.tagName) && /^[a-z]/.test(openingElement.tagName.text);

const deduplicateCallbacks = (
  callbacks: ReadonlyArray<ComponentCallbackDescriptor>,
): ReadonlyArray<ComponentCallbackDescriptor> => {
  const callbacksByIdentity = new Map<string, ComponentCallbackDescriptor>();
  for (const callback of callbacks) {
    const guardIdentity = callback.guards
      .map((guard) => `${guard.conditionIdentity}=${String(guard.polarity)}`)
      .sort()
      .join("&");
    const callbackIdentity = `${getNodeIdentity(callback.ownerFunction)}:${getNodeIdentity(callback.callbackFunction)}:${guardIdentity}`;
    const existingCallback = callbacksByIdentity.get(callbackIdentity);
    callbacksByIdentity.set(callbackIdentity, {
      ...callback,
      bindings: existingCallback
        ? mergeCallableBindings([existingCallback.bindings, callback.bindings])
        : callback.bindings,
    });
  }
  return [...callbacksByIdentity.values()];
};

const collectComponentPropReferences = (
  callbackFunction: ts.FunctionLikeDeclaration,
  ownerFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ComponentPropReference> => {
  const referencesByIdentity = new Map<string, ComponentPropReference>();
  for (const reachableFunction of collectReachableFunctions(callbackFunction, typeChecker)) {
    const visit = (node: ts.Node): void => {
      if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
      const expression =
        ts.isPropertyAccessExpression(node) ||
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
      const rootIdentifier = expression ? getRootIdentifier(expression) : null;
      const symbol = rootIdentifier ? typeChecker.getSymbolAtLocation(rootIdentifier) : null;
      if (expression && propName && symbol) {
        const propertyName = ts.isPropertyAccessExpression(expression) ? propName : null;
        referencesByIdentity.set(`${getSymbolIdentity(symbol)}:${propertyName ?? ""}`, {
          channel: { functionNode: ownerFunction, propName },
          isComplete: !symbol.declarations?.some(
            (declaration) =>
              (ts.isBindingElement(declaration) &&
                Boolean(declaration.initializer || declaration.dotDotDotToken)) ||
              (ts.isParameter(declaration) && Boolean(declaration.initializer)),
          ),
          propertyName,
          symbol,
        });
      } else if (
        expression &&
        symbol &&
        isComponentPropExpression(expression, ownerFunction, typeChecker)
      ) {
        referencesByIdentity.set(`${getSymbolIdentity(symbol)}:unresolved`, {
          channel: null,
          isComplete: false,
          propertyName: null,
          symbol,
        });
      }
      node.forEachChild(visit);
    };
    reachableFunction.functionNode.forEachChild(visit);
  }
  return [...referencesByIdentity.values()];
};

const createCallbackSourceValue = (
  source: ResolvedCallbackSource,
): ResolvedCallableValueDescriptor => ({
  isComplete: source.isComplete,
  properties: new Map(),
  targets: source.callbacks.map((callback) => ({
    bindings: callback.bindings,
    functionNode: callback.callbackFunction,
    guards: callback.guards,
    isConditionallyReached: source.callbacks.length > 1,
  })),
});

const createExpressionCallbackSource = (
  expression: ts.Expression,
  ownerFunction: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): CallbackSource => {
  const callableValue = resolveCallableExpression(expression, typeChecker);
  const callbacks = callableValue.targets.map(
    (target): ComponentCallbackDescriptor => ({
      bindings: target.bindings,
      callbackFunction: target.functionNode,
      guards: target.guards,
      ownerFunction,
    }),
  );
  return {
    callbacks,
    channel: getComponentPropChannel(expression, ownerFunction, typeChecker),
    isComplete: callableValue.isComplete && callbacks.length > 0,
  };
};

export const createComponentCallbackFlow = (
  componentFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>,
  unitFunctionsBySymbol: ReadonlyMap<ts.Symbol, ts.FunctionLikeDeclaration>,
  typeChecker: ts.TypeChecker,
): ComponentCallbackFlowDescriptor => {
  const propBindingsByChannel = new Map<string, ComponentPropBinding[]>();
  const eventSources: Array<{
    eventName: string;
    node: ts.JsxAttribute;
    ownerFunction: ts.FunctionLikeDeclaration;
    source: CallbackSource;
  }> = [];
  const componentPropReferencesByCallback = new Map<
    string,
    ReadonlyArray<ComponentPropReference>
  >();
  const getCallbackComponentPropReferences = (
    callbackFunction: ts.FunctionLikeDeclaration,
    ownerFunction: ts.FunctionLikeDeclaration,
  ): ReadonlyArray<ComponentPropReference> => {
    const callbackIdentity = `${getNodeIdentity(ownerFunction)}:${getNodeIdentity(callbackFunction)}`;
    const existingReferences = componentPropReferencesByCallback.get(callbackIdentity);
    if (existingReferences) return existingReferences;
    const references = collectComponentPropReferences(callbackFunction, ownerFunction, typeChecker);
    componentPropReferencesByCallback.set(callbackIdentity, references);
    return references;
  };

  for (const ownerFunction of componentFunctions) {
    for (const reachableFunction of collectReachableFunctions(ownerFunction, typeChecker)) {
      const visit = (node: ts.Node): void => {
        if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
        const openingElement = getOpeningElement(node);
        if (!openingElement) {
          node.forEachChild(visit);
          return;
        }
        const targetFunction = getTargetFunction(
          openingElement,
          unitFunctionsBySymbol,
          typeChecker,
        );
        for (const attribute of openingElement.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) continue;
          const expression = getJsxAttributeExpression(attribute);
          if (!expression) continue;
          const source = createExpressionCallbackSource(expression, ownerFunction, typeChecker);
          const propName = attribute.name.getText();
          if (isIntrinsicElement(openingElement) && REACT_EVENT_PROP_PATTERN.test(propName)) {
            eventSources.push({
              eventName: propName,
              node: attribute,
              ownerFunction,
              source,
            });
          }
          if (targetFunction) {
            const targetChannel = { functionNode: targetFunction, propName };
            const channelIdentity = getChannelIdentity(targetChannel);
            const bindings = propBindingsByChannel.get(channelIdentity) ?? [];
            bindings.push({
              callbacks: source.callbacks,
              isComplete: source.isComplete,
              node: attribute,
              renderNode: openingElement,
              renderOwnerFunction: ownerFunction,
              sourceChannel: source.channel,
              targetChannel,
              targetFunction,
            });
            propBindingsByChannel.set(channelIdentity, bindings);
          }
        }
        openingElement.forEachChild(visit);
      };
      reachableFunction.functionNode.forEachChild(visit);
    }
  }

  const requiredPhasesByChannel = new Map<string, Set<ReactExecutionPhase>>();
  const resolveCallbackSource = (
    source: CallbackSource,
    resolvingChannelIds: ReadonlySet<string>,
    phase: ReactExecutionPhase,
  ): ResolvedCallbackSource => {
    if (source.callbacks.length > 0) {
      let isComplete = source.isComplete;
      const callbacks = source.callbacks.map((callback) => {
        const capturedBindings = new Map<ts.Symbol, ResolvedCallableValueDescriptor>();
        for (const reference of getCallbackComponentPropReferences(
          callback.callbackFunction,
          callback.ownerFunction,
        )) {
          if (!reference.isComplete) isComplete = false;
          if (!reference.channel) continue;
          const capturedSource = resolveCallbackSource(
            {
              callbacks: [],
              channel: reference.channel,
              isComplete: false,
            },
            resolvingChannelIds,
            phase,
          );
          const capturedValue = createCallbackSourceValue(capturedSource);
          if (!capturedSource.isComplete) isComplete = false;
          if (!reference.propertyName) {
            capturedBindings.set(reference.symbol, capturedValue);
            continue;
          }
          const existingOwnerValue = capturedBindings.get(reference.symbol);
          const ownerValue: ResolvedCallableValueDescriptor = existingOwnerValue ?? {
            isComplete: true,
            properties: new Map(),
            targets: [],
          };
          capturedBindings.set(reference.symbol, {
            ...ownerValue,
            properties: new Map([
              ...ownerValue.properties,
              [reference.propertyName, capturedValue],
            ]),
          });
        }
        return {
          ...callback,
          bindings: mergeCallableBindings([callback.bindings, capturedBindings]),
        };
      });
      return { callbacks: deduplicateCallbacks(callbacks), isComplete };
    }
    if (!source.channel) return { callbacks: [], isComplete: false };

    const channel = source.channel;
    const channelIdentity = getChannelIdentity(channel);
    const requiredPhases = requiredPhasesByChannel.get(channelIdentity) ?? new Set();
    requiredPhases.add(phase);
    requiredPhasesByChannel.set(channelIdentity, requiredPhases);
    if (resolvingChannelIds.has(channelIdentity)) {
      return { callbacks: [], isComplete: false };
    }
    const bindings = propBindingsByChannel.get(channelIdentity);
    if (!bindings || bindings.length === 0) {
      return { callbacks: [], isComplete: false };
    }
    const nextResolvingChannelIds = new Set(resolvingChannelIds);
    nextResolvingChannelIds.add(channelIdentity);
    const callbacks: ComponentCallbackDescriptor[] = [];
    let isComplete = true;
    for (const binding of bindings) {
      const resolvedBinding = resolveCallbackSource(
        {
          callbacks: binding.callbacks,
          channel: binding.sourceChannel,
          isComplete: binding.isComplete,
        },
        nextResolvingChannelIds,
        phase,
      );
      callbacks.push(...resolvedBinding.callbacks);
      if (!resolvedBinding.isComplete) isComplete = false;
    }
    return {
      callbacks: deduplicateCallbacks(callbacks),
      isComplete: isComplete && callbacks.length > 0,
    };
  };

  const bindings = eventSources.map((eventSource): ComponentEventBindingDescriptor => {
    const resolvedSource = resolveCallbackSource(
      eventSource.source,
      new Set(),
      ReactExecutionPhase.Event,
    );
    return {
      callbacks: resolvedSource.callbacks,
      eventName: eventSource.eventName,
      isComplete: resolvedSource.isComplete,
      node: eventSource.node,
      ownerFunction: eventSource.ownerFunction,
    };
  });

  return {
    bindings,
    collectPropFlows: () =>
      [...propBindingsByChannel].flatMap(([channelIdentity, channelBindings]) => {
        const requiredPhases = requiredPhasesByChannel.get(channelIdentity);
        if (!requiredPhases) return [];
        return [...requiredPhases].flatMap((phase) =>
          channelBindings.map((binding): ComponentCallbackPropFlowDescriptor => {
            const resolvedSource = resolveCallbackSource(
              {
                callbacks: binding.callbacks,
                channel: binding.sourceChannel,
                isComplete: binding.isComplete,
              },
              new Set(),
              phase,
            );
            return {
              callbacks: resolvedSource.callbacks,
              isComplete: resolvedSource.isComplete,
              node: binding.node,
              phase,
              propName: binding.targetChannel.propName,
              renderNode: binding.renderNode,
              renderOwnerFunction: binding.renderOwnerFunction,
              targetFunction: binding.targetFunction,
            };
          }),
        );
      }),
    resolveCallback: (callbackFunction, ownerFunction, phase) => {
      const resolvedSource = resolveCallbackSource(
        {
          callbacks: [
            {
              bindings: new Map(),
              callbackFunction,
              guards: [],
              ownerFunction,
            },
          ],
          channel: null,
          isComplete: true,
        },
        new Set(),
        phase,
      );
      return {
        bindings: resolvedSource.callbacks[0]?.bindings ?? new Map(),
      };
    },
    resolveExpression: (expression, ownerFunction, phase) =>
      resolveCallbackSource(
        createExpressionCallbackSource(expression, ownerFunction, typeChecker),
        new Set(),
        phase,
      ),
  };
};
