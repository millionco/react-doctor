// rule: effect-needs-cleanup
// verdict: fail
// weakness: cleanup-guard
// source: independently-synthetic
import { useEffect } from "react";
interface Subscription {
  remove: () => void;
}
declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};
export const AsyncSubscriptionPanel = () => {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });
    return () => {
      cancelled = true;
      const allowRelease = false;
      allowRelease && subscription.remove();
    };
  }, []);
  return null;
};
