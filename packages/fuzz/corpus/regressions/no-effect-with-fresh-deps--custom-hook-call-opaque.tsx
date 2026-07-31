// rule: no-effect-with-fresh-deps
// verdict: pass
// weakness: library-idiom
// source: React Bench write-react-xr843-fojin-775__6TM24iQ and write-react-softmaple-softmaple__mGtA7Dm

import { useCallback, useEffect, useRef } from "react";

interface SubscriptionOptions {
  readonly onValue: () => void;
}

interface SubscriberProps {
  readonly onValue: () => void;
}

const useStableCallback = <Arguments extends unknown[], Result>(
  callback: (...arguments_: Arguments) => Result,
): ((...arguments_: Arguments) => Result) => {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...arguments_: Arguments) => callbackRef.current(...arguments_), []);
};

const useSubscription = (options: SubscriptionOptions): void => {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  useEffect(() => subscribe(() => optionsRef.current.onValue()), []);
};

export const Subscriber = ({ onValue }: SubscriberProps) => {
  const stableCallback = useStableCallback(() => onValue());
  useSubscription({ onValue: stableCallback });
  return null;
};
