// rule: rules-of-hooks
// verdict: pass
// weakness: name-heuristic
// source: aidenybai/bippy@01338495471adfef59b203717a295d78938001dd, inspect-hooks.ts:421-455
const inspectionLog: unknown[] = [];
const readState = (value: unknown) => {
  inspectionLog.push(value);
  return [value, () => {}];
};
const readContext = (context: { current: unknown }) => context.current;
const recordEffect = (callback: () => void) => {
  inspectionLog.push(callback);
};
const recordEvent = (callback: () => void) => {
  inspectionLog.push(callback);
  return callback;
};
const createInspector = (kind: string) => (value: unknown) => {
  inspectionLog.push(kind);
  return value;
};
const readAction = createInspector("action");
const readMemo = (create: () => unknown) => create();
const readCache = (length: number) => Array.from({ length }, () => null);
const Local = {
  useContext: readContext,
  useState: readState,
  useReducer: readState,
  useRef: readState,
  useEffect: recordEffect,
  useEffectEvent: recordEvent,
  useActionState: readAction,
  useMemo: readMemo,
  useMemoCache: readCache,
};
const Alias = Local;

export const collectStack = () => {
  try {
    Alias.useContext({ current: null });
    Alias.useState(null);
    Alias.useReducer(null);
    Alias.useRef(null);
    Alias.useEffect(() => {});
    Alias.useActionState(null);
    Alias.useMemo(() => null);
    Alias.useMemoCache(0);
    if (typeof Alias.useEffectEvent === "function") Alias.useEffectEvent(() => {});
  } finally {
    inspectionLog.length = 0;
  }
};
