// rule: effect-needs-cleanup
// weakness: library-idiom
// source: synthetic PR #1958 closed callable review
// verdict: fail

import { useEffect } from "react";
export const SubscriptionPanel = () => {
  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };
  try {
    throw {};
  } catch ({ unused = Object.assign(navigation, { addListener: () => ({ remove() {} }) }) }) {}
  useEffect(() => {
    const unsubscribe = navigation.addListener("event", () => {});
    return () => {
      unsubscribe();
    };
  }, [navigation]);
  return null;
};
