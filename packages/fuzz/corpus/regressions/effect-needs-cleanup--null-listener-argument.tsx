// rule: effect-needs-cleanup
// weakness: alias-guard
// source: synthetic
// verdict: pass
import React, { useEffect } from "react";

const registerNullableListener = (callback: EventListener | null | undefined) => {
  const listener = callback;
  window.addEventListener("resize", listener);
};

export const NullableListenerPanel = () => {
  useEffect(() => {
    registerNullableListener(null);
    registerNullableListener(undefined);
  }, []);
  return null;
};

let replacedListener: EventListener | null = () => {};
replacedListener = null;
const registerReplacedListener = () => {
  window.addEventListener("resize", replacedListener);
};
const listenerHolder = { listener: null };
const registerAbsentMember = () => {
  window.addEventListener("resize", listenerHolder.listener);
};

export const AbsentListenerPanel = () => {
  useEffect(() => {
    registerReplacedListener();
    registerAbsentMember();
  }, []);
  return null;
};

Object.defineProperty(React, "useCallback", { value: () => null });
const replacedCallback = Reflect.apply(React.useCallback, undefined, [() => {}, []]);
const registerCallbackListener = () => {
  window.addEventListener("resize", replacedCallback);
};
export const ReplacedCallbackProviderPanel = () => {
  useEffect(() => {
    registerCallbackListener();
  }, []);
  return null;
};
