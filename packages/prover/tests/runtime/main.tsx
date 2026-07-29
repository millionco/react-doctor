import {
  Component,
  Suspense,
  StrictMode,
  createContext,
  lazy,
  memo,
  use,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import type { ChangeEvent, ReactNode, Ref } from "react";
import { useFormStatus } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  ACTION_STATE_DELAY_MS,
  ACTION_STATE_INITIAL_RUNS,
  FAST_QUERY_DELAY_MS,
  FORM_STATUS_ACTION_DELAY_MS,
  FORM_STATUS_ACTION_INITIAL_RUNS,
  HOOK_STATE_INCREMENT,
  HOOK_STATE_INITIAL_COUNT,
  HOOK_STATE_UPDATER_INITIAL_RUNS,
  CLASS_UPDATE_INITIAL_REVISION,
  CLASS_UPDATE_NEXT_REVISION,
  INITIAL_CALLBACK_REVISION,
  LAZY_COMPONENT_DELAY_MS,
  LAZY_INITIAL_REVISION,
  LAZY_REVISION_INCREMENT,
  NEXT_CALLBACK_REVISION,
  OPTIMISTIC_ACTION_DELAY_MS,
  OPTIMISTIC_ACTION_INITIAL_RUNS,
  PRIMARY_STORE_INITIAL_VERSION,
  REDUCER_INITIAL_COUNT,
  REDUCER_INCREMENT,
  REDUCER_INITIAL_RUNS,
  SCHEDULER_CALLBACK_DELAY_MS,
  SECONDARY_STORE_INITIAL_VERSION,
  SLOW_QUERY_DELAY_MS,
  STORE_VERSION_INCREMENT,
  STRICT_MODE_CONSTRUCTION_RUNS,
  STRICT_MODE_HOOK_UPDATER_RUNS,
  STRICT_MODE_REDUCER_RUNS,
  TRANSITION_ACTION_DELAY_MS,
  TRANSITION_ACTION_INITIAL_RUNS,
  UNOBSERVED_CALLBACK_REVISION,
} from "./constants.js";

declare global {
  interface Window {
    effectEventSetupRuns: number;
    formStatusActionRuns: number;
    actionStateRuns: number;
    classListenerHits: number;
    classMounts: number;
    classSchedulerHits: number;
    classStateUpdates: number;
    classStateWrites: number;
    classDirectStateValue: number;
    classConstructorRuns: number;
    classFieldInitializerRuns: number;
    classUnmounts: number;
    listenerHits: number;
    lazyLoaderRuns: number;
    observerHits: number;
    schedulerHits: number;
    hookStateUpdaterRuns: number;
    optimisticActionRuns: number;
    reducerInitializerRuns: number;
    reducerRuns: number;
    transitionActionRuns: number;
  }
}

window.effectEventSetupRuns = 0;
window.formStatusActionRuns = FORM_STATUS_ACTION_INITIAL_RUNS;
window.actionStateRuns = ACTION_STATE_INITIAL_RUNS;
window.classListenerHits = 0;
window.classMounts = 0;
window.classSchedulerHits = 0;
window.classStateUpdates = 0;
window.classStateWrites = 0;
window.classDirectStateValue = CLASS_UPDATE_INITIAL_REVISION;
window.classConstructorRuns = CLASS_UPDATE_INITIAL_REVISION;
window.classFieldInitializerRuns = CLASS_UPDATE_INITIAL_REVISION;
window.classUnmounts = 0;
window.listenerHits = 0;
window.lazyLoaderRuns = 0;
window.observerHits = 0;
window.schedulerHits = 0;
window.hookStateUpdaterRuns = HOOK_STATE_UPDATER_INITIAL_RUNS;
window.optimisticActionRuns = OPTIMISTIC_ACTION_INITIAL_RUNS;
window.reducerInitializerRuns = REDUCER_INITIAL_RUNS;
window.reducerRuns = REDUCER_INITIAL_RUNS;
window.transitionActionRuns = TRANSITION_ACTION_INITIAL_RUNS;

const LazySuspenseContent = lazy(async () => {
  window.lazyLoaderRuns += 1;
  await new Promise((resolve) => {
    setTimeout(resolve, LAZY_COMPONENT_DELAY_MS);
  });
  return import("./lazy-suspense-content.js");
});

const LazySuspenseOracle = () => {
  const [revision, setRevision] = useState(LAZY_INITIAL_REVISION);
  return (
    <main>
      <button
        type="button"
        onClick={() => setRevision((currentRevision) => currentRevision + LAZY_REVISION_INCREMENT)}
      >
        rerender lazy parent
      </button>
      <Suspense fallback={<output data-testid="lazy-fallback">loading lazy content</output>}>
        <LazySuspenseContent revision={revision} />
      </Suspense>
    </main>
  );
};

interface ErrorBoundaryProperties {
  children: ReactNode;
  fallback: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProperties, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

let resolveUseResource: (value: string) => void = () => {};
let rejectUseResource: (reason: Error) => void = () => {};
const useResourcePromise = new Promise<string>((resolve, reject) => {
  resolveUseResource = resolve;
  rejectUseResource = reject;
});

const UseResourceContent = () => (
  <output data-testid="use-resource-content">{use(useResourcePromise)}</output>
);

const UseResourceOracle = () => (
  <main>
    <button type="button" onClick={() => resolveUseResource("resource ready")}>
      resolve resource
    </button>
    <button type="button" onClick={() => rejectUseResource(new Error("resource failed"))}>
      reject resource
    </button>
    <ErrorBoundary
      fallback={<output data-testid="use-resource-error">resource unavailable</output>}
    >
      <Suspense fallback={<output data-testid="use-resource-pending">resource pending</output>}>
        <UseResourceContent />
      </Suspense>
    </ErrorBoundary>
  </main>
);

const ThrowingRenderFailure = () => {
  throw new Error("descendant render failed");
};

const ThrowingFallback = () => {
  throw new Error("boundary fallback failed");
};

const ErrorBoundaryOracle = () => {
  const doesFallbackThrow =
    new URLSearchParams(window.location.search).get("mode") === "throwing-fallback";
  if (doesFallbackThrow) {
    return (
      <ErrorBoundary fallback={<output data-testid="outer-error-fallback">outer caught</output>}>
        <ErrorBoundary fallback={<ThrowingFallback />}>
          <ThrowingRenderFailure />
        </ErrorBoundary>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary fallback={<output data-testid="error-fallback">caught</output>}>
      <ThrowingRenderFailure />
    </ErrorBoundary>
  );
};

interface ReducerOracleState {
  count: number;
}

const initializeReducerOracle = (initialCount: number): ReducerOracleState => {
  window.reducerInitializerRuns += 1;
  return { count: initialCount };
};

const reduceReducerOracle = (
  state: ReducerOracleState,
  action: "increment",
): ReducerOracleState => {
  window.reducerRuns += 1;
  if (action === "increment") {
    return { count: state.count + REDUCER_INCREMENT };
  }
  return state;
};

const ReducerTransitionOracle = () => {
  const [state, dispatch] = useReducer(
    reduceReducerOracle,
    REDUCER_INITIAL_COUNT,
    initializeReducerOracle,
  );
  return (
    <main>
      <button type="button" onClick={() => dispatch("increment")}>
        run reducer
      </button>
      <output data-testid="reducer-count">{state.count}</output>
      <output data-testid="expected-reducer-runs">{STRICT_MODE_REDUCER_RUNS}</output>
    </main>
  );
};

interface OptimisticTodo {
  label: string;
  isPending: boolean;
}

const submitFormStatus = async (formData: FormData) => {
  window.formStatusActionRuns += 1;
  String(formData.get("username"));
  await new Promise((resolve) => {
    setTimeout(resolve, FORM_STATUS_ACTION_DELAY_MS);
  });
};

const FormStatusDetails = () => {
  const status = useFormStatus();
  return (
    <>
      <button type="submit" disabled={status.pending}>
        {status.pending ? "requesting username" : "request username"}
      </button>
      <output data-testid="form-status-pending">{String(status.pending)}</output>
      <output data-testid="form-status-data">
        {status.data ? String(status.data.get("username")) : "none"}
      </output>
      <output data-testid="form-status-method">{status.method}</output>
      <output data-testid="form-status-action">{String(status.action === submitFormStatus)}</output>
    </>
  );
};

const FormStatusOracle = () => {
  const sameComponentStatus = useFormStatus();
  return (
    <main>
      <form action={submitFormStatus}>
        <label>
          Username
          <input name="username" />
        </label>
        <FormStatusDetails />
      </form>
      <output data-testid="same-component-form-status">
        {String(sameComponentStatus.pending)}
      </output>
    </main>
  );
};

interface FormStatusSlotShellProperties {
  children: ReactNode;
}

const FormStatusSlotShell = ({ children }: FormStatusSlotShellProperties) => (
  <form action={submitFormStatus}>
    <label>
      Username
      <input name="username" />
    </label>
    {children}
  </form>
);

const FormStatusSlotOracle = () => (
  <main>
    <FormStatusSlotShell>
      <FormStatusDetails />
    </FormStatusSlotShell>
  </main>
);

const ActionStateOracle = () => {
  const [submittedItems, submitItem, isPending] = useActionState(
    async (previousItems: ReadonlyArray<string>, formData: FormData) => {
      window.actionStateRuns += 1;
      const item = String(formData.get("item"));
      await new Promise((resolve) => {
        setTimeout(resolve, ACTION_STATE_DELAY_MS);
      });
      return [...previousItems, item];
    },
    [],
  );
  return (
    <main>
      <form action={submitItem}>
        <input name="item" />
        <button type="submit">submit item</button>
      </form>
      <output data-testid="action-state-items">{submittedItems.join("|")}</output>
      <output data-testid="action-state-pending">{String(isPending)}</output>
    </main>
  );
};

const OptimisticFormActionOracle = () => {
  const [confirmedTodos, setConfirmedTodos] = useState<ReadonlyArray<OptimisticTodo>>([
    { label: "Read", isPending: false },
  ]);
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    confirmedTodos,
    (pendingTodos, label: string) => [...pendingTodos, { label, isPending: true }],
  );
  const submitAction = async (formData: FormData) => {
    window.optimisticActionRuns += 1;
    const label = String(formData.get("todo"));
    addOptimisticTodo(label);
    await new Promise((resolve) => {
      setTimeout(resolve, OPTIMISTIC_ACTION_DELAY_MS);
    });
    setConfirmedTodos((previousTodos) => [...previousTodos, { label, isPending: false }]);
  };
  return (
    <main>
      <form action={submitAction}>
        <input name="todo" defaultValue="Write" />
        <button type="submit">add todo</button>
      </form>
      <output data-testid="optimistic-todos">
        {optimisticTodos
          .map((todo) => `${todo.label}:${todo.isPending ? "pending" : "confirmed"}`)
          .join("|")}
      </output>
      <output data-testid="optimistic-pending">
        {String(optimisticTodos.some((todo) => todo.isPending))}
      </output>
    </main>
  );
};

const TransitionActionOracle = () => {
  const [panel, setPanel] = useState("overview");
  const [isPending, startPanelTransition] = useTransition();
  const showActivity = () => {
    startPanelTransition(async () => {
      window.transitionActionRuns += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, TRANSITION_ACTION_DELAY_MS);
      });
      startPanelTransition(() => setPanel("activity"));
    });
  };
  return (
    <main>
      <button type="button" onClick={showActivity}>
        show activity
      </button>
      <output data-testid="transition-panel">{panel}</output>
      <output data-testid="transition-pending">{String(isPending)}</output>
    </main>
  );
};

const HookStateTransitionOracle = () => {
  const [count, setCount] = useState(HOOK_STATE_INITIAL_COUNT);
  return (
    <main>
      <button
        type="button"
        onClick={() =>
          setCount((previousCount) => {
            window.hookStateUpdaterRuns += 1;
            return previousCount + HOOK_STATE_INCREMENT;
          })
        }
      >
        increment
      </button>
      <output data-testid="hook-state-count">{count}</output>
      <output data-testid="expected-hook-state-updater-runs">
        {STRICT_MODE_HOOK_UPDATER_RUNS}
      </output>
    </main>
  );
};

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

class SafeClassListener extends Component {
  handleResize() {
    window.classListenerHits += 1;
  }

  componentDidMount() {
    window.classMounts += 1;
    window.addEventListener("prover-class-resize", this.handleResize);
  }

  componentWillUnmount() {
    window.classUnmounts += 1;
    window.removeEventListener("prover-class-resize", this.handleResize);
  }

  render() {
    return null;
  }
}

class LeakyClassListener extends Component {
  handleResize() {
    window.classListenerHits += 1;
  }

  componentDidMount() {
    window.classMounts += 1;
    window.addEventListener("prover-class-resize", this.handleResize);
  }

  componentWillUnmount() {
    window.classUnmounts += 1;
  }

  render() {
    return null;
  }
}

const ClassListenerOracle = () => {
  const [isMounted, setIsMounted] = useState(true);
  const isSafeMode = new URLSearchParams(window.location.search).get("mode") === "safe";
  const Listener = isSafeMode ? SafeClassListener : LeakyClassListener;
  return (
    <main>
      <button type="button" onClick={() => setIsMounted(false)}>
        unmount class listener
      </button>
      <button type="button" onClick={() => window.dispatchEvent(new Event("prover-class-resize"))}>
        dispatch class event
      </button>
      {isMounted ? <Listener /> : null}
    </main>
  );
};

class SafeClassScheduler extends Component {
  timeoutId = 0;

  handleTimeout() {
    window.classSchedulerHits += 1;
  }

  componentDidMount() {
    window.classMounts += 1;
    this.timeoutId = window.setTimeout(this.handleTimeout, SCHEDULER_CALLBACK_DELAY_MS);
  }

  componentWillUnmount() {
    window.classUnmounts += 1;
    window.clearTimeout(this.timeoutId);
  }

  render() {
    return null;
  }
}

class LeakyClassScheduler extends Component {
  timeoutId = 0;

  handleTimeout() {
    window.classSchedulerHits += 1;
  }

  componentDidMount() {
    window.classMounts += 1;
    this.timeoutId = window.setTimeout(this.handleTimeout, SCHEDULER_CALLBACK_DELAY_MS);
  }

  componentWillUnmount() {
    window.classUnmounts += 1;
  }

  render() {
    return null;
  }
}

const ClassSchedulerOracle = () => {
  const [isMounted, setIsMounted] = useState(true);
  const isSafeMode = new URLSearchParams(window.location.search).get("mode") === "safe";
  const Scheduler = isSafeMode ? SafeClassScheduler : LeakyClassScheduler;
  return (
    <main>
      <button type="button" onClick={() => setIsMounted(false)}>
        unmount class scheduler
      </button>
      {isMounted ? <Scheduler /> : null}
    </main>
  );
};

interface ClassDraftProperties {
  value: string;
}

interface ClassDraftState {
  draft: string;
}

class GuardedClassDraft extends Component<ClassDraftProperties, ClassDraftState> {
  state = { draft: "alpha" };

  componentDidUpdate(previousProperties: ClassDraftProperties) {
    window.classStateUpdates += 1;
    if (previousProperties.value !== this.props.value) {
      window.classStateWrites += 1;
      this.setState({ draft: this.props.value });
    }
  }

  render() {
    return <output data-testid="class-draft">{this.state.draft}</output>;
  }
}

interface LoopState {
  revision: number;
}

interface LoopProperties {
  triggerRevision: number;
}

class UnguardedClassUpdate extends Component<LoopProperties, LoopState> {
  state = { revision: CLASS_UPDATE_INITIAL_REVISION };

  componentDidUpdate() {
    window.classStateUpdates += 1;
    this.setState({ revision: CLASS_UPDATE_NEXT_REVISION });
  }

  render() {
    return <output>{this.state.revision}</output>;
  }
}

const ClassStateTransitionOracle = () => {
  const [value, setValue] = useState("alpha");
  const [loopRevision, setLoopRevision] = useState(CLASS_UPDATE_INITIAL_REVISION);
  const isGuardedMode = new URLSearchParams(window.location.search).get("mode") === "guarded";
  if (isGuardedMode) {
    return (
      <main>
        <button type="button" onClick={() => setValue("beta")}>
          update class prop
        </button>
        <GuardedClassDraft value={value} />
      </main>
    );
  }
  return (
    <main>
      <button type="button" onClick={() => setLoopRevision(CLASS_UPDATE_NEXT_REVISION)}>
        trigger class loop
      </button>
      <UnguardedClassUpdate triggerRevision={loopRevision} />
    </main>
  );
};

interface DirectStateMutationState {
  count: number;
}

class DirectStateMutation extends Component<Record<string, never>, DirectStateMutationState> {
  state = { count: CLASS_UPDATE_INITIAL_REVISION };

  mutateState = () => {
    this.state.count = CLASS_UPDATE_NEXT_REVISION;
    window.classDirectStateValue = this.state.count;
  };

  render() {
    return (
      <main>
        <button type="button" onClick={this.mutateState}>
          mutate class state directly
        </button>
        <output data-testid="direct-class-state">{this.state.count}</output>
      </main>
    );
  }
}

const ClassStateOwnershipOracle = () => <DirectStateMutation />;

interface ConstructionProbeState {
  run: number;
}

class ConstructorConstructionProbe extends Component<
  Record<string, never>,
  ConstructionProbeState
> {
  constructor(properties: Record<string, never>) {
    super(properties);
    window.classConstructorRuns += CLASS_UPDATE_NEXT_REVISION;
    this.state = { run: window.classConstructorRuns };
  }

  render() {
    return <output data-testid="constructor-run">{this.state.run}</output>;
  }
}

const initializeFieldConstructionState = (): ConstructionProbeState => {
  window.classFieldInitializerRuns += CLASS_UPDATE_NEXT_REVISION;
  return { run: window.classFieldInitializerRuns };
};

class FieldConstructionProbe extends Component<Record<string, never>, ConstructionProbeState> {
  state = initializeFieldConstructionState();

  render() {
    return <output data-testid="field-initializer-run">{this.state.run}</output>;
  }
}

const ClassConstructionOracle = () => (
  <main data-expected-construction-runs={STRICT_MODE_CONSTRUCTION_RUNS}>
    <ConstructorConstructionProbe />
    <FieldConstructionProbe />
  </main>
);

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

interface ObserverProbeProperties {
  shouldDisconnect: boolean;
}

const ObserverProbe = ({ shouldDisconnect }: ObserverProbeProperties) => {
  useEffect(() => {
    const observer = new MutationObserver(() => {
      window.observerHits += 1;
    });
    observer.observe(document.body, { childList: true });
    if (shouldDisconnect) return () => observer.disconnect();
    return undefined;
  }, [shouldDisconnect]);
  return null;
};

const ObserverLifetimeOracle = () => {
  const [isMounted, setIsMounted] = useState(true);
  const shouldDisconnect = new URLSearchParams(window.location.search).get("mode") === "disconnect";
  return (
    <main>
      <button type="button" onClick={() => setIsMounted(false)}>
        unmount observer
      </button>
      {isMounted ? <ObserverProbe shouldDisconnect={shouldDisconnect} /> : null}
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

interface ImperativeHandle {
  readLabel: () => string;
}

interface ImperativeHandleProbeProperties {
  label: string;
  ref: Ref<ImperativeHandle>;
}

const SafeImperativeHandleProbe = ({ label, ref }: ImperativeHandleProbeProperties) => {
  useImperativeHandle(ref, () => ({ readLabel: () => label }), [label]);
  return null;
};

const StaleImperativeHandleProbe = ({ label, ref }: ImperativeHandleProbeProperties) => {
  useImperativeHandle(ref, () => ({ readLabel: () => label }), []);
  return null;
};

const ImperativeHandleOracle = () => {
  const [label, setLabel] = useState("alpha");
  const [observedLabel, setObservedLabel] = useState("unobserved");
  const handleRef = useRef<ImperativeHandle | null>(null);
  const isSafeMode = new URLSearchParams(window.location.search).get("mode") === "safe";
  const Probe = isSafeMode ? SafeImperativeHandleProbe : StaleImperativeHandleProbe;
  return (
    <main>
      <button type="button" onClick={() => setLabel("beta")}>
        advance label
      </button>
      <button
        type="button"
        onClick={() => setObservedLabel(handleRef.current?.readLabel() ?? "missing")}
      >
        read handle
      </button>
      <Probe ref={handleRef} label={label} />
      <output data-testid="observed-handle-label">{observedLabel}</output>
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
  if (oracle === "imperative-handle") {
    return <ImperativeHandleOracle />;
  }
  if (oracle === "scheduler-lifetime") {
    return <SchedulerLifetimeOracle />;
  }
  if (oracle === "observer-lifetime") {
    return <ObserverLifetimeOracle />;
  }
  if (oracle === "class-listener") {
    return <ClassListenerOracle />;
  }
  if (oracle === "class-scheduler") {
    return <ClassSchedulerOracle />;
  }
  if (oracle === "class-state-transition") {
    return <ClassStateTransitionOracle />;
  }
  if (oracle === "class-state-ownership") {
    return <ClassStateOwnershipOracle />;
  }
  if (oracle === "class-construction") {
    return <ClassConstructionOracle />;
  }
  if (oracle === "hook-state-transition") {
    return <HookStateTransitionOracle />;
  }
  if (oracle === "reducer-transition") {
    return <ReducerTransitionOracle />;
  }
  if (oracle === "lazy-suspense") {
    return <LazySuspenseOracle />;
  }
  if (oracle === "error-boundary") {
    return <ErrorBoundaryOracle />;
  }
  if (oracle === "use-resource") {
    return <UseResourceOracle />;
  }
  if (oracle === "transition-action") {
    return <TransitionActionOracle />;
  }
  if (oracle === "optimistic-form-action") {
    return <OptimisticFormActionOracle />;
  }
  if (oracle === "action-state") {
    return <ActionStateOracle />;
  }
  if (oracle === "form-status") {
    return <FormStatusOracle />;
  }
  if (oracle === "form-status-slot") {
    return <FormStatusSlotOracle />;
  }
  return <ListenerOracle />;
};

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing runtime oracle root");
const oracle = new URLSearchParams(window.location.search).get("oracle");
const isStrictModeOracle =
  oracle === "class-listener" ||
  oracle === "class-scheduler" ||
  oracle === "class-construction" ||
  oracle === "class-state-ownership" ||
  oracle === "class-state-transition" ||
  oracle === "hook-state-transition" ||
  oracle === "lazy-suspense" ||
  oracle === "error-boundary" ||
  oracle === "use-resource" ||
  oracle === "reducer-transition" ||
  oracle === "transition-action" ||
  oracle === "optimistic-form-action" ||
  oracle === "action-state" ||
  oracle === "form-status" ||
  oracle === "form-status-slot";
createRoot(rootElement).render(
  isStrictModeOracle ? (
    <StrictMode>
      <RuntimeOracle />
    </StrictMode>
  ) : (
    <RuntimeOracle />
  ),
);
