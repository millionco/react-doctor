// rule: effect-needs-cleanup
// weakness: library-idiom
// source: synthetic PR #1958 closed callable review
// verdict: pass

import { useEffect } from "react";
export const SubscriptionPanel = () => {
  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };
  useEffect(() => {
    const unsubscribe = navigation.addListener("event", () => {});
    return () => {
      unsubscribe();
    };
  }, [navigation]);
  return null;
};
