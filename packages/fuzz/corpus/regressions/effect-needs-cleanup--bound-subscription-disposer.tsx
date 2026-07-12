// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: ISSUES_TO_FIX_ASAP.md cross-version cleanup matrix
import { useEffect } from "react";

export const SubscriptionFeed = ({
  store,
}: {
  store: { subscribe: (callback: () => void) => { unsubscribe: () => void } };
}) => {
  useEffect(() => {
    const subscription = store.subscribe(() => undefined);
    return subscription.unsubscribe.bind(subscription);
  }, [store]);
  return null;
};
