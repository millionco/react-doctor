// rule: effect-needs-cleanup
// verdict: pass
// weakness: library-idiom
// source: synthetic effect-local Set listener and paired disposer
import { useEffect } from "react";

export const Widget = ({ handler }: { handler: () => void }) => {
  useEffect(() => {
    const subscribers = new Set<() => void>();
    const channel = {
      addListener(listener: () => void) {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
    };
    const dispose = channel.addListener(handler);
    return () => dispose();
  }, [handler]);
  return null;
};
