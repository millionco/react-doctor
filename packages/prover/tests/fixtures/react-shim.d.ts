declare module "react" {
  export type Key = string | number | bigint;
  export type ReactNode = unknown;

  export interface ReactPortal {
    children: ReactNode;
    key: Key | null;
  }

  export interface ChangeEvent<Target> {
    currentTarget: Target;
  }

  export interface Context<Value> {
    (properties: { value?: Value; children?: unknown }): null;
    Provider: (properties: { value?: Value; children?: unknown }) => null;
  }

  export interface MutableRefObject<Value> {
    current: Value;
  }

  export interface RefCallback<Value> {
    (value: Value | null): void;
  }

  export type Ref<Value> = MutableRefObject<Value | null> | RefCallback<Value> | null;

  export interface ComponentType<Properties = Record<string, unknown>> {
    (properties: Properties): unknown;
  }

  export const useCallback: <Value extends (...argumentsList: ReadonlyArray<never>) => unknown>(
    callback: Value,
    dependencies: ReadonlyArray<unknown>,
  ) => Value;
  export interface Use {
    <Value>(usable: PromiseLike<Value>): Value;
    <Value>(usable: Context<Value>): Value;
  }

  export const use: Use;
  export const useActionState: {
    <State>(
      reducerAction: (previousState: State) => State | Promise<State>,
      initialState: State,
      permalink?: string,
    ): [State, () => void, boolean];
    <State, ActionPayload>(
      reducerAction: (previousState: State, actionPayload: ActionPayload) => State | Promise<State>,
      initialState: State,
      permalink?: string,
    ): [State, (actionPayload: ActionPayload) => void, boolean];
  };
  export const createContext: <Value>(defaultValue: Value) => Context<Value>;
  export const Children: {
    map: <Child, Result>(
      children: Child,
      transform: (child: Child) => Result,
    ) => ReadonlyArray<Result>;
  };
  export interface Memo {
    <Properties>(
      component: ComponentType<Properties>,
      comparator?: (
        previousProperties: Readonly<Properties>,
        nextProperties: Readonly<Properties>,
      ) => boolean,
    ): ComponentType<Properties>;
    <Component>(component: Component): Component;
  }

  export const memo: Memo;
  export const lazy: <Module extends { default: unknown }>(
    load: () => PromiseLike<Module>,
  ) => ComponentType<Record<string, unknown>>;
  export const Suspense: ComponentType<{ fallback?: ReactNode; children?: ReactNode }>;
  export const forwardRef: <Handle, Properties>(
    render: (properties: Properties, ref: Ref<Handle>) => unknown,
  ) => (properties: Properties & { ref?: Ref<Handle> }) => unknown;
  export const StrictMode: (properties: { children?: unknown }) => unknown;
  export const startTransition: (action: () => void | Promise<void>) => void;
  export const useEffect: (
    setup: () => void | (() => void),
    dependencies?: ReadonlyArray<unknown>,
  ) => void;
  export const useEffectEvent: <Callback extends (...argumentsList: never[]) => unknown>(
    callback: Callback,
  ) => Callback;
  export const useLayoutEffect: typeof useEffect;
  export const useImperativeHandle: <Handle>(
    ref: Ref<Handle> | undefined,
    createHandle: () => Handle,
    dependencies?: ReadonlyArray<unknown>,
  ) => void;
  export const useId: () => string;
  export const useMemo: <Value>(
    factory: () => Value,
    dependencies: ReadonlyArray<unknown>,
  ) => Value;
  export const useOptimistic: {
    <State>(
      passthrough: State,
    ): [State, (updateAction: State | ((pendingState: State) => State)) => void];
    <State, Action>(
      passthrough: State,
      reducer: (pendingState: State, action: Action) => State,
    ): [State, (action: Action) => void];
  };
  export const useRef: <Value>(initialValue: Value) => MutableRefObject<Value>;
  export const useContext: <Value>(context: Context<Value>) => Value;
  export const useReducer: {
    <State, Action>(
      reducer: (state: State, action: Action) => State,
      initialState: State,
    ): [State, (action: Action) => void];
    <State, Action, InitialArg>(
      reducer: (state: State, action: Action) => State,
      initialArg: InitialArg,
      initializer: (initialArg: InitialArg) => State,
    ): [State, (action: Action) => void];
  };
  export const useState: <Value>(
    initialValue: Value | (() => Value),
  ) => [Value, (nextValue: Value | ((previousValue: Value) => Value)) => void];
  export const useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot?: () => Snapshot,
  ) => Snapshot;
  export const useTransition: () => [boolean, typeof startTransition];

  export class Component<Properties = Record<string, unknown>, State = Record<string, unknown>> {
    constructor(properties: Properties);
    props: Properties;
    state: State;
    setState(
      nextState:
        | Partial<State>
        | null
        | ((
            previousState: Readonly<State>,
            properties: Readonly<Properties>,
          ) => Partial<State> | State | null),
      callback?: () => void,
    ): void;
  }

  export class PureComponent<
    Properties = Record<string, unknown>,
    State = Record<string, unknown>,
  > extends Component<Properties, State> {}
}

declare module "react/jsx-runtime" {
  export const Fragment: unknown;
  export const jsx: (...argumentsList: ReadonlyArray<unknown>) => unknown;
  export const jsxs: (...argumentsList: ReadonlyArray<unknown>) => unknown;
}

declare module "react-dom/client" {
  export interface Root {
    render(children: unknown): void;
  }

  export interface RootOptions {
    identifierPrefix?: string;
    onRecoverableError?: (error: unknown) => void;
  }

  export const createRoot: (container: Element | DocumentFragment, options?: RootOptions) => Root;
  export const hydrateRoot: (
    container: Element | Document,
    children: unknown,
    options?: RootOptions,
  ) => Root;
}

declare module "react-dom/server" {
  export interface ServerOptions {
    identifierPrefix?: string;
  }

  export const renderToPipeableStream: (children: unknown, options?: ServerOptions) => unknown;
  export const renderToReadableStream: (
    children: unknown,
    options?: ServerOptions,
  ) => Promise<ReadableStream>;
  export const renderToStaticMarkup: (children: unknown, options?: ServerOptions) => string;
  export const renderToString: (children: unknown, options?: ServerOptions) => string;
}

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: string | number;
  }

  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>;
  }
}
