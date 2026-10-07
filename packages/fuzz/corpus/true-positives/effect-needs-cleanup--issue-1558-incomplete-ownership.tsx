// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1559 adversarial review
// verdict: fail

import { useEffect, useLayoutEffect, useRef } from "react";

export const TimersAndListeners = ({ tabs, videoId }) => {
  const timerRef = useRef(null);

  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    unsubscribers.pop();
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [tabs]);

  useLayoutEffect(() => {
    timerRef.current = setTimeout(() => {}, 4000);
  }, [videoId]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return null;
};
