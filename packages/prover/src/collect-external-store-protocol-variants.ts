import ts from "typescript";
import { findFunctionByLocation } from "./find-function-by-location.js";
import { ReactExecutionPhase } from "./types.js";
import type {
  ReactAnalysisContext,
  ReactSemanticCallbackPropAlternative,
  ReactSemanticExternalStore,
} from "./types.js";

export interface ExternalStoreProtocolVariant {
  isComplete: boolean;
  renderId: string | null;
  serverSnapshotFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>;
  snapshotFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>;
  subscribeFunctions: ReadonlyArray<ts.FunctionLikeDeclaration>;
}

interface ExternalStoreProtocolChannel {
  alternatives: ReadonlyArray<ReactSemanticCallbackPropAlternative>;
  isComplete: boolean;
}

interface ExternalStoreProtocolChannels {
  serverSnapshot: ExternalStoreProtocolChannel;
  snapshot: ExternalStoreProtocolChannel;
  subscribe: ExternalStoreProtocolChannel;
}

interface GuardedExternalStoreProtocolChannel {
  alternativesByGuard: ReadonlyMap<string, ReactSemanticCallbackPropAlternative> | null;
  channel: ExternalStoreProtocolChannel;
}

interface CollectExternalStoreProtocolVariantsInput {
  context: ReactAnalysisContext;
  externalStore: ReactSemanticExternalStore;
  serverSnapshotPropName: string | null;
  snapshotPropName: string | null;
  subscribePropName: string | null;
}

const createUnguardedAlternatives = (
  callbackIds: ReadonlyArray<string>,
): ReadonlyArray<ReactSemanticCallbackPropAlternative> =>
  callbackIds.map((callbackId) => ({ callbackId, guards: [] }));

const getGuardSignature = (alternative: ReactSemanticCallbackPropAlternative): string =>
  alternative.guards
    .map((guard) => `${guard.id}=${String(guard.polarity)}`)
    .sort()
    .join("&");

const getGuardedAlternatives = (
  channel: ExternalStoreProtocolChannel,
): ReadonlyMap<string, ReactSemanticCallbackPropAlternative> | null => {
  const guardedAlternatives = channel.alternatives.filter(
    (alternative) => alternative.guards.length > 0,
  );
  if (guardedAlternatives.length === 0) {
    return channel.alternatives.length <= 1 ? new Map() : null;
  }
  if (guardedAlternatives.length !== channel.alternatives.length) return null;
  const alternativesByGuard = new Map<string, ReactSemanticCallbackPropAlternative>();
  for (const alternative of guardedAlternatives) {
    const guardSignature = getGuardSignature(alternative);
    if (!guardSignature || alternativesByGuard.has(guardSignature)) return null;
    alternativesByGuard.set(guardSignature, alternative);
  }
  return alternativesByGuard;
};

const haveEqualKeys = (
  first: ReadonlyMap<string, ReactSemanticCallbackPropAlternative>,
  second: ReadonlyMap<string, ReactSemanticCallbackPropAlternative>,
): boolean => first.size === second.size && [...first.keys()].every((key) => second.has(key));

export const collectExternalStoreProtocolVariants = ({
  context,
  externalStore,
  serverSnapshotPropName,
  snapshotPropName,
  subscribePropName,
}: CollectExternalStoreProtocolVariantsInput): ReadonlyArray<ExternalStoreProtocolVariant> => {
  const callbacksById = new Map(
    context.graph?.callbacks.map((callback) => [callback.id, callback]) ?? [],
  );
  const resolveCallbackFunctions = (
    alternatives: ReadonlyArray<ReactSemanticCallbackPropAlternative>,
  ): ReadonlyArray<ts.FunctionLikeDeclaration> =>
    alternatives.flatMap((alternative) => {
      const callback = callbacksById.get(alternative.callbackId);
      if (!callback) return [];
      const callbackFunction = findFunctionByLocation(
        context.program,
        context.rootDirectory,
        callback.location,
      );
      return callbackFunction ? [callbackFunction] : [];
    });
  const getChannel = (
    renderId: string,
    propName: string | null,
    phase: ReactExecutionPhase,
    fallbackCallbackIds: ReadonlyArray<string>,
    fallbackIsComplete: boolean,
  ): ExternalStoreProtocolChannel => {
    if (!propName) {
      return {
        alternatives: createUnguardedAlternatives(fallbackCallbackIds),
        isComplete: fallbackIsComplete,
      };
    }
    const propFlows =
      context.graph?.callbackPropFlows.filter(
        (propFlow) =>
          propFlow.renderId === renderId &&
          propFlow.targetOwnerId === externalStore.ownerId &&
          propFlow.propName === propName &&
          propFlow.phase === phase,
      ) ?? [];
    return {
      alternatives: propFlows.flatMap((propFlow) => propFlow.alternatives),
      isComplete: propFlows.length > 0 && propFlows.every((propFlow) => propFlow.complete),
    };
  };
  const propChannels = [
    {
      phase: ReactExecutionPhase.ExternalStoreSubscription,
      propName: subscribePropName,
    },
    {
      phase: ReactExecutionPhase.Render,
      propName: snapshotPropName,
    },
    {
      phase: ReactExecutionPhase.ServerRender,
      propName: serverSnapshotPropName,
    },
  ];
  const renderIds = new Set(
    context.graph?.callbackPropFlows
      .filter(
        (propFlow) =>
          propFlow.targetOwnerId === externalStore.ownerId &&
          propChannels.some(
            (channel) => channel.propName === propFlow.propName && channel.phase === propFlow.phase,
          ),
      )
      .map((propFlow) => propFlow.renderId) ?? [],
  );
  if (renderIds.size === 0) {
    if (propChannels.some((channel) => channel.propName)) return [];
    return [
      {
        isComplete:
          externalStore.subscribeComplete &&
          externalStore.snapshotComplete &&
          externalStore.serverSnapshotComplete,
        renderId: null,
        subscribeFunctions: resolveCallbackFunctions(
          createUnguardedAlternatives(externalStore.subscribeCallbackIds),
        ),
        snapshotFunctions: resolveCallbackFunctions(
          createUnguardedAlternatives(externalStore.snapshotCallbackIds),
        ),
        serverSnapshotFunctions: resolveCallbackFunctions(
          createUnguardedAlternatives(externalStore.serverSnapshotCallbackIds),
        ),
      },
    ];
  }
  return [...renderIds].flatMap((renderId): ReadonlyArray<ExternalStoreProtocolVariant> => {
    const channels: ExternalStoreProtocolChannels = {
      subscribe: getChannel(
        renderId,
        subscribePropName,
        ReactExecutionPhase.ExternalStoreSubscription,
        externalStore.subscribeCallbackIds,
        externalStore.subscribeComplete,
      ),
      snapshot: getChannel(
        renderId,
        snapshotPropName,
        ReactExecutionPhase.Render,
        externalStore.snapshotCallbackIds,
        externalStore.snapshotComplete,
      ),
      serverSnapshot: getChannel(
        renderId,
        serverSnapshotPropName,
        ReactExecutionPhase.ServerRender,
        externalStore.serverSnapshotCallbackIds,
        externalStore.serverSnapshotComplete,
      ),
    };
    const guardedSubscribeChannel: GuardedExternalStoreProtocolChannel = {
      alternativesByGuard: getGuardedAlternatives(channels.subscribe),
      channel: channels.subscribe,
    };
    const guardedSnapshotChannel: GuardedExternalStoreProtocolChannel = {
      alternativesByGuard: getGuardedAlternatives(channels.snapshot),
      channel: channels.snapshot,
    };
    const guardedServerSnapshotChannel: GuardedExternalStoreProtocolChannel = {
      alternativesByGuard: getGuardedAlternatives(channels.serverSnapshot),
      channel: channels.serverSnapshot,
    };
    const guardedChannels = [
      guardedSubscribeChannel,
      guardedSnapshotChannel,
      guardedServerSnapshotChannel,
    ];
    const referenceGuardedChannel = guardedChannels.find((guardedChannel) =>
      Boolean(guardedChannel.alternativesByGuard?.size),
    );
    const arePartitionsCompatible = guardedChannels.every(
      (guardedChannel) =>
        guardedChannel.alternativesByGuard &&
        (!guardedChannel.alternativesByGuard.size ||
          !referenceGuardedChannel?.alternativesByGuard ||
          haveEqualKeys(
            guardedChannel.alternativesByGuard,
            referenceGuardedChannel.alternativesByGuard,
          )),
    );
    const areChannelsComplete = guardedChannels.every(
      (guardedChannel) => guardedChannel.channel.isComplete,
    );
    if (!arePartitionsCompatible || !referenceGuardedChannel?.alternativesByGuard) {
      return [
        {
          isComplete: areChannelsComplete && arePartitionsCompatible,
          renderId,
          subscribeFunctions: resolveCallbackFunctions(channels.subscribe.alternatives),
          snapshotFunctions: resolveCallbackFunctions(channels.snapshot.alternatives),
          serverSnapshotFunctions: resolveCallbackFunctions(channels.serverSnapshot.alternatives),
        },
      ];
    }
    return [...referenceGuardedChannel.alternativesByGuard.keys()].map(
      (guardSignature): ExternalStoreProtocolVariant => {
        const selectAlternatives = (
          guardedChannel: GuardedExternalStoreProtocolChannel,
        ): ReadonlyArray<ReactSemanticCallbackPropAlternative> => {
          const guardedAlternative = guardedChannel.alternativesByGuard?.get(guardSignature);
          return guardedAlternative ? [guardedAlternative] : guardedChannel.channel.alternatives;
        };
        return {
          isComplete: areChannelsComplete,
          renderId,
          subscribeFunctions: resolveCallbackFunctions(selectAlternatives(guardedSubscribeChannel)),
          snapshotFunctions: resolveCallbackFunctions(selectAlternatives(guardedSnapshotChannel)),
          serverSnapshotFunctions: resolveCallbackFunctions(
            selectAlternatives(guardedServerSnapshotChannel),
          ),
        };
      },
    );
  });
};
