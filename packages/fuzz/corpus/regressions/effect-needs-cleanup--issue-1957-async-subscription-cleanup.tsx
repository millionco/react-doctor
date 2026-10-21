import { useEffect } from "react";

type Subscription = { remove: () => void };

declare const Accelerometer: {
  isAvailableAsync: () => Promise<boolean>;
  addListener: (callback: () => void) => Subscription;
};

export function AsyncSubscribeWithOptionalChaining() {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;

    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return null;
}

export function AsyncSubscribeWithExplicitNullCheck() {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;

    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });

    return () => {
      cancelled = true;
      if (subscription !== null) {
        subscription.remove();
      }
    };
  }, []);

  return null;
}

export function AsyncSubscribeWithLogicalAnd() {
  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;

    void Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      subscription = Accelerometer.addListener(() => {});
    });

    return () => {
      cancelled = true;
      subscription && subscription.remove();
    };
  }, []);

  return null;
}
