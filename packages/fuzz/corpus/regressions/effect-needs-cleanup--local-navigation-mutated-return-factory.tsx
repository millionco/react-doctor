// rule: effect-needs-cleanup
// weakness: alias-guard
// source: synthetic PR #1958 callable-return dependency review
// verdict: fail

import { useEffect } from "react";
function createDisposer() {
  return () => {};
}
createDisposer = () => ({ remove() {} });
export const SubscriptionPanel = () => {
  const navigation = { addListener: () => createDisposer() };
  useEffect(() => {
    const unsubscribe = navigation.addListener("event", () => {});
    return () => {
      unsubscribe();
    };
  }, [navigation]);
  return null;
};
