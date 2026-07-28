import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  FAST_QUERY_DELAY_MS,
  INITIAL_CALLBACK_REVISION,
  NEXT_CALLBACK_REVISION,
  PRIMARY_STORE_INITIAL_VERSION,
  SCHEDULER_CALLBACK_DELAY_MS,
  SECONDARY_STORE_INITIAL_VERSION,
  SLOW_QUERY_DELAY_MS,
  STORE_VERSION_INCREMENT,
  UNOBSERVED_CALLBACK_REVISION,
} from "./constants.js";

declare global {
  interface Window {
    effectEventSetupRuns: number;
    listenerHits: number;
    schedulerHits: number;
  }
}

window.effectEventSetupRuns = 0;
window.listenerHits = 0;
window.schedulerHits = 0;

const LeakyListener = () => {
  useEffect(() => {
    window.addEventListener("prover-resize", () => {
      window.listenerHits += 1;
    });
    return () => {
      window.removeEventListener("prover-resize", () => {
        window.listenerHits += 1;
      });
    };
  }, []);
  return null;
};

const SafeListener = () => {
  useEffect(() => {
    const handleResize = () => {
      window.listenerHits += 1;
    };
    window.addEventListener("prover-resize", handleResize);
    return () => window.removeEventListener("prover-resize", handleResize);
  }, []);
  return null;
};

const ListenerOracle = () => {
  const [isMounted, setIsMounted] = useState(true);
  const isSafeMode = new URLSearchParams(window.location.search).get("mode") === "safe";
  const Listener = isSafeMode ? SafeListener : LeakyListener;
  return (
    <main>
      <button type="button" onClick={() => setIsMounted(false)}>
        unmount
      </button>
      <button type="button" onClick={() => window.dispatchEvent(new Event("prover-resize"))}>
        dispatch
      </button>
      <output data-testid="listener-hits">{window.listenerHits}</output>
      {isMounted ? <Listener /> : null}
    </main>
  );
};

interface SchedulerProbeProperties {
  shouldCancel: boolean;
}

const SchedulerProbe = ({ shouldCancel }: SchedulerProbeProperties) => {
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.schedulerHits += 1;
    }, SCHEDULER_CALLBACK_DELAY_MS);
    if (shouldCancel) return () => window.clearTimeout(timeoutId);
    return undefined;
  }, [shouldCancel]);
  return null;
};

const SchedulerLifetimeOracle = () => {
  const [isMounted, setIsMounted] = useState(true);
  const shouldCancel = new URLSearchParams(window.location.search).get("mode") === "cancel";
  return (
    <main>
      <button type="button" onClick={() => setIsMounted(false)}>
        unmount scheduler
      </button>
      {isMounted ? <SchedulerProbe shouldCancel={shouldCancel} /> : null}
    </main>
  );
};

interface KeyedItem {
  id: string;
  label: string;
}

interface StatefulItemProperties {
  item: KeyedItem;
}

const StatefulItem = ({ item }: StatefulItemProperties) => {
  const [draft, setDraft] = useState("");
  return (
    <li>
      <label>
        {item.label}
        <input
          value={draft}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.currentTarget.value)}
        />
      </label>
    </li>
  );
};

const ReconciliationOracle = () => {
  const [items, setItems] = useState<ReadonlyArray<KeyedItem>>([
    { id: "alpha", label: "Alpha" },
    { id: "beta", label: "Beta" },
  ]);
  const isIndexMode = new URLSearchParams(window.location.search).get("mode") === "index";
  return (
    <main>
      <button type="button" onClick={() => setItems([...items].reverse())}>
        reverse
      </button>
      <ul>
        {items.map((item, itemIndex) => (
          <StatefulItem key={isIndexMode ? itemIndex : item.id} item={item} />
        ))}
      </ul>
    </main>
  );
};

interface ConnectionSnapshot {
  online: boolean;
}

const CACHED_CONNECTION_SNAPSHOT: ConnectionSnapshot = { online: true };
const subscribeToStaticStore = (_listener: () => void) => () => undefined;

interface ExternalStoreReaderProperties {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ConnectionSnapshot;
}

const ExternalStoreReader = ({ subscribe, getSnapshot }: ExternalStoreReaderProperties) => {
  const connection = useSyncExternalStore(subscribe, getSnapshot);
  return <output data-testid="connection">{connection.online ? "online" : "offline"}</output>;
};

const ExternalStoreOracle = () => {
  const isSafeMode = new URLSearchParams(window.location.search).get("mode") === "safe";
  const getSnapshot = isSafeMode ? () => CACHED_CONNECTION_SNAPSHOT : () => ({ online: true });
  return <ExternalStoreReader subscribe={subscribeToStaticStore} getSnapshot={getSnapshot} />;
};

const EffectEventLatestValueOracle = () => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [eventHits, setEventHits] = useState(0);
  const isSafeMode = new URLSearchParams(window.location.search).get("mode") === "safe";
  const onRuntimeEvent = useEffectEvent(() => {
    if (isEnabled) setEventHits((currentHits) => currentHits + 1);
  });

  useEffect(() => {
    const staleHandler = () => {
      if (isEnabled) setEventHits((currentHits) => currentHits + 1);
    };
    const handler = isSafeMode ? onRuntimeEvent : staleHandler;
    window.addEventListener("prover-effect-event", handler);
    return () => window.removeEventListener("prover-effect-event", handler);
  }, []);

  return (
    <main>
      <button type="button" onClick={() => setIsEnabled(false)}>
        disable
      </button>
      <button type="button" onClick={() => window.dispatchEvent(new Event("prover-effect-event"))}>
        dispatch
      </button>
      <output data-testid="effect-event-hits">{eventHits}</output>
    </main>
  );
};

let primaryStoreVersion = PRIMARY_STORE_INITIAL_VERSION;
let secondaryStoreVersion = SECONDARY_STORE_INITIAL_VERSION;
const primaryStoreListeners = new Set<() => void>();
const secondaryStoreListeners = new Set<() => void>();

const subscribeToPrimaryStore = (listener: () => void) => {
  primaryStoreListeners.add(listener);
  return () => primaryStoreListeners.delete(listener);
};

const subscribeToSecondaryStore = (listener: () => void) => {
  secondaryStoreListeners.add(listener);
  return () => secondaryStoreListeners.delete(listener);
};

const getPrimaryStoreSnapshot = () => primaryStoreVersion;
const getSecondaryStoreSnapshot = () => secondaryStoreVersion;

interface ExternalStoreVersionReaderProperties {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

const ExternalStoreVersionReader = ({
  subscribe,
  getSnapshot,
}: ExternalStoreVersionReaderProperties) => {
  const version = useSyncExternalStore(subscribe, getSnapshot);
  return <output data-testid="store-version">{version}</output>;
};

const CorrelatedExternalStoreOracle = () => {
  const [useSecondaryStore, setUseSecondaryStore] = useState(false);
  const updatePrimaryStore = () => {
    primaryStoreVersion += STORE_VERSION_INCREMENT;
    for (const listener of primaryStoreListeners) listener();
  };
  const updateSecondaryStore = () => {
    secondaryStoreVersion += STORE_VERSION_INCREMENT;
    for (const listener of secondaryStoreListeners) listener();
  };
  return (
    <main>
      <button type="button" onClick={updatePrimaryStore}>
        update primary
      </button>
      <button type="button" onClick={updateSecondaryStore}>
        update secondary
      </button>
      <button type="button" onClick={() => setUseSecondaryStore(!useSecondaryStore)}>
        switch store
      </button>
      {useSecondaryStore ? (
        <ExternalStoreVersionReader
          subscribe={subscribeToSecondaryStore}
          getSnapshot={getSecondaryStoreSnapshot}
        />
      ) : (
        <ExternalStoreVersionReader
          subscribe={subscribeToPrimaryStore}
          getSnapshot={getPrimaryStoreSnapshot}
        />
      )}
    </main>
  );
};

const GuardedExternalStoreOracle = () => {
  const [useSecondaryStore, setUseSecondaryStore] = useState(false);
  const updatePrimaryStore = () => {
    primaryStoreVersion += STORE_VERSION_INCREMENT;
    for (const listener of primaryStoreListeners) listener();
  };
  const updateSecondaryStore = () => {
    secondaryStoreVersion += STORE_VERSION_INCREMENT;
    for (const listener of secondaryStoreListeners) listener();
  };
  return (
    <main>
      <button type="button" onClick={updatePrimaryStore}>
        update primary
      </button>
      <button type="button" onClick={updateSecondaryStore}>
        update secondary
      </button>
      <button type="button" onClick={() => setUseSecondaryStore(!useSecondaryStore)}>
        switch store
      </button>
      <ExternalStoreVersionReader
        subscribe={useSecondaryStore ? subscribeToSecondaryStore : subscribeToPrimaryStore}
        getSnapshot={useSecondaryStore ? getSecondaryStoreSnapshot : getPrimaryStoreSnapshot}
      />
    </main>
  );
};

const EffectEventIdentityOracle = () => {
  const [revision, setRevision] = useState(0);
  const onEffectEvent = useEffectEvent(() => undefined);
  useEffect(() => {
    window.effectEventSetupRuns += 1;
  }, [onEffectEvent]);

  return (
    <button type="button" onClick={() => setRevision(revision + 1)}>
      rerender {revision}
    </button>
  );
};

const NavigationContext = createContext("POP");

const MemoizedNavigationReader = memo(() => {
  const navigationType = useContext(NavigationContext);
  const [observedNavigation, setObservedNavigation] = useState("unobserved");
  const onReadNavigation = useEffectEvent(() => setObservedNavigation(navigationType));
  useEffect(() => {
    window.addEventListener("prover-read-navigation", onReadNavigation);
    return () => window.removeEventListener("prover-read-navigation", onReadNavigation);
  }, []);
  return (
    <>
      <output data-testid="rendered-navigation">{navigationType}</output>
      <output data-testid="observed-navigation">{observedNavigation}</output>
    </>
  );
});

const EffectEventMemoContextOracle = () => {
  const [navigationType, setNavigationType] = useState("POP");
  return (
    <NavigationContext.Provider value={navigationType}>
      <button type="button" onClick={() => setNavigationType("REPLACE")}>
        navigate
      </button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("prover-read-navigation"))}
      >
        inspect
      </button>
      <MemoizedNavigationReader />
    </NavigationContext.Provider>
  );
};

const RuntimeProviderContext = createContext("provider-default");
const RuntimeConsumerContext = createContext("consumer-default");

interface ContextIdentityConsumerProperties {
  useProviderIdentity: boolean;
}

const ContextIdentityConsumer = ({ useProviderIdentity }: ContextIdentityConsumerProperties) => {
  const value = useContext(useProviderIdentity ? RuntimeProviderContext : RuntimeConsumerContext);
  return <output data-testid="context-identity-value">{value}</output>;
};

const ContextIdentityOracle = () => {
  const useProviderIdentity = new URLSearchParams(window.location.search).get("mode") === "same";
  return (
    <RuntimeProviderContext.Provider value="provided">
      <ContextIdentityConsumer useProviderIdentity={useProviderIdentity} />
    </RuntimeProviderContext.Provider>
  );
};

const TabsContext = createContext("outside");

interface TabValueProperties {
  testId: string;
}

const TabValue = ({ testId }: TabValueProperties) => {
  const value = useContext(TabsContext);
  return <output data-testid={testId}>{value}</output>;
};

const NestedContextOracle = () => {
  const hasNestedProvider = new URLSearchParams(window.location.search).get("mode") === "nested";
  return (
    <TabsContext.Provider value="outer">
      <TabValue testId="outer-context-value" />
      {hasNestedProvider ? (
        <TabsContext.Provider value="inner">
          <TabValue testId="inner-context-value" />
        </TabsContext.Provider>
      ) : (
        <TabValue testId="inner-context-value" />
      )}
    </TabsContext.Provider>
  );
};

const loadRuntimeQuery = (query: string): Promise<string> =>
  new Promise((resolve) => {
    const delay = query === "alpha" ? SLOW_QUERY_DELAY_MS : FAST_QUERY_DELAY_MS;
    setTimeout(() => resolve(query), delay);
  });

const AsyncEffectOwnershipOracle = () => {
  const [query, setQuery] = useState("alpha");
  const [result, setResult] = useState("pending");
  const isSafeMode = new URLSearchParams(window.location.search).get("mode") === "safe";

  useEffect(() => {
    let didLoseOwnership = false;
    const loadResult = async () => {
      const nextResult = await loadRuntimeQuery(query);
      if (!isSafeMode || !didLoseOwnership) setResult(nextResult);
    };
    void loadResult();
    return () => {
      didLoseOwnership = true;
    };
  }, [isSafeMode, query]);

  return (
    <main>
      <button type="button" onClick={() => setQuery("beta")}>
        load beta
      </button>
      <output data-testid="async-query-result">{result}</output>
    </main>
  );
};

interface JsxSpreadOrderProperties {
  onClick?: () => void;
}

const JsxSpreadOrderOracle = () => {
  const [lastHandler, setLastHandler] = useState("none");
  const isExplicitLast =
    new URLSearchParams(window.location.search).get("mode") === "explicit-last";
  const spreadProperties: JsxSpreadOrderProperties = {
    onClick: () => setLastHandler("spread"),
  };
  const handleExplicitClick = () => setLastHandler("explicit");
  return (
    <main>
      {isExplicitLast ? (
        <button type="button" {...spreadProperties} onClick={handleExplicitClick}>
          activate
        </button>
      ) : (
        <button type="button" onClick={handleExplicitClick} {...spreadProperties}>
          activate
        </button>
      )}
      <output data-testid="last-handler">{lastHandler}</output>
    </main>
  );
};

interface CallableRefProbeProperties {
  onObservedRevision: (revision: number) => void;
  revision: number;
}

const useLayoutSynchronizedCallback = (callback: () => void) => {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback(() => callbackRef.current(), []);
};

const usePassiveSynchronizedCallback = (callback: () => void) => {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback(() => callbackRef.current(), []);
};

const LayoutCallableRefProbe = ({ onObservedRevision, revision }: CallableRefProbeProperties) => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const handleProbe = useLayoutSynchronizedCallback(() => onObservedRevision(revision));
  useLayoutEffect(() => {
    if (revision === NEXT_CALLBACK_REVISION) buttonRef.current?.click();
  }, [revision]);
  return (
    <button ref={buttonRef} type="button" onClick={handleProbe}>
      phase probe
    </button>
  );
};

const PassiveCallableRefProbe = ({ onObservedRevision, revision }: CallableRefProbeProperties) => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const handleProbe = usePassiveSynchronizedCallback(() => onObservedRevision(revision));
  useLayoutEffect(() => {
    if (revision === NEXT_CALLBACK_REVISION) buttonRef.current?.click();
  }, [revision]);
  return (
    <button ref={buttonRef} type="button" onClick={handleProbe}>
      phase probe
    </button>
  );
};

const CallableRefPhaseOracle = () => {
  const [revision, setRevision] = useState(INITIAL_CALLBACK_REVISION);
  const [observedRevision, setObservedRevision] = useState(UNOBSERVED_CALLBACK_REVISION);
  const isLayoutMode = new URLSearchParams(window.location.search).get("mode") === "layout";
  const Probe = isLayoutMode ? LayoutCallableRefProbe : PassiveCallableRefProbe;
  return (
    <main>
      <button type="button" onClick={() => setRevision(NEXT_CALLBACK_REVISION)}>
        advance revision
      </button>
      <Probe revision={revision} onObservedRevision={setObservedRevision} />
      <output data-testid="observed-callback-revision">{observedRevision}</output>
    </main>
  );
};

const RuntimeOracle = () => {
  const oracle = new URLSearchParams(window.location.search).get("oracle");
  if (oracle === "keys") {
    return <ReconciliationOracle />;
  }
  if (oracle === "external-store") {
    return <ExternalStoreOracle />;
  }
  if (oracle === "external-store-branches") {
    return <CorrelatedExternalStoreOracle />;
  }
  if (oracle === "external-store-conditional") {
    return <GuardedExternalStoreOracle />;
  }
  if (oracle === "effect-event") {
    return <EffectEventLatestValueOracle />;
  }
  if (oracle === "effect-event-identity") {
    return <EffectEventIdentityOracle />;
  }
  if (oracle === "effect-event-memo-context") {
    return <EffectEventMemoContextOracle />;
  }
  if (oracle === "context-identity") {
    return <ContextIdentityOracle />;
  }
  if (oracle === "nested-context") {
    return <NestedContextOracle />;
  }
  if (oracle === "async-effect-ownership") {
    return <AsyncEffectOwnershipOracle />;
  }
  if (oracle === "jsx-spread-order") {
    return <JsxSpreadOrderOracle />;
  }
  if (oracle === "callable-ref-phase") {
    return <CallableRefPhaseOracle />;
  }
  if (oracle === "scheduler-lifetime") {
    return <SchedulerLifetimeOracle />;
  }
  return <ListenerOracle />;
};

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing runtime oracle root");
createRoot(rootElement).render(<RuntimeOracle />);
