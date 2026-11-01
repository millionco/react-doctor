// rule: no-ref-current-in-render
// verdict: pass
// weakness: cross-file
// source: synthetic
// file-path: corpus/regressions/no-ref-current-in-render--typed-redux/panel.tsx
import { useRef } from "react";
import { Provider } from "react-redux";
import { makeStore, type Store } from "./store";

export const CounterPanel = ({ children }) => {
  const store = useRef<Store>(undefined);
  if (!store.current) {
    store.current = makeStore();
  }
  return <Provider store={store.current}>{children}</Provider>;
};
