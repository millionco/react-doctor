declare module "react" {
  export interface ChangeEvent<Target> {
    currentTarget: Target;
  }

  export interface Context<Value> {
    Provider: (properties: { value?: Value; children?: unknown }) => null;
  }

  export interface MutableRefObject<Value> {
    current: Value;
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
  export const createContext: <Value>(defaultValue: Value) => Context<Value>;
  export const memo: <Component>(component: Component) => Component;
  export const StrictMode: (properties: { children?: unknown }) => unknown;
  export const useEffect: (
    setup: () => void | (() => void),
    dependencies?: ReadonlyArray<unknown>,
  ) => void;
  export const useEffectEvent: <Callback extends (...argumentsList: never[]) => unknown>(
    callback: Callback,
  ) => Callback;
  export const useLayoutEffect: typeof useEffect;
  export const useMemo: <Value>(
    factory: () => Value,
    dependencies: ReadonlyArray<unknown>,
  ) => Value;
  export const useRef: <Value>(initialValue: Value) => MutableRefObject<Value>;
  export const useContext: <Value>(context: Context<Value>) => Value;
  export const useReducer: <State, Action>(
    reducer: (state: State, action: Action) => State,
    initialState: State,
  ) => [State, (action: Action) => void];
  export const useState: <Value>(
    initialValue: Value | (() => Value),
  ) => [Value, (nextValue: Value | ((previousValue: Value) => Value)) => void];
  export const useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot?: () => Snapshot,
  ) => Snapshot;

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

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: string | number;
  }

  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>;
  }
}
