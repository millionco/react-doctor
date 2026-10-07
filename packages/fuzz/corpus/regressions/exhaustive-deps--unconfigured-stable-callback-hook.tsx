// rule: exhaustive-deps
// verdict: pass
// weakness: framework-gating
// source: React Bench write-react-xr843-fojin-775__6TM24iQ

import { useCallback, useEffect, useRef } from "react";

const useStableCallback = <Arguments extends unknown[], Result>(
  callback: (...argumentsForCallback: Arguments) => Result,
) => {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback(
    (...argumentsForCallback: Arguments) => callbackRef.current(...argumentsForCallback),
    [],
  );
};

interface ChatProps {
  readonly cite: (message: string) => void;
  readonly rate: (message: string) => void;
  readonly retry: (message: string) => void;
  readonly send: (message: string) => void;
  readonly share: (message: string) => void;
}

export const Chat = ({ send, share, retry, cite, rate }: ChatProps) => {
  const sendMessage = useStableCallback((message: string) => send(message));
  const shareMessage = useStableCallback((message: string) => share(message));
  const retryMessage = useStableCallback((message: string) => retry(message));
  const citeMessage = useStableCallback((message: string) => cite(message));
  const rateMessage = useStableCallback((message: string) => rate(message));
  return (
    <button
      onClick={() => {
        sendMessage("send");
        shareMessage("share");
        retryMessage("retry");
        citeMessage("cite");
        rateMessage("rate");
      }}
    >
      Run callbacks
    </button>
  );
};
