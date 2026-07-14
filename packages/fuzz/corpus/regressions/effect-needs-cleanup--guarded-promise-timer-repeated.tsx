// rule: effect-needs-cleanup
// weakness: async-lifecycle-provenance
// source: issue #1241 adversarial review
import { useEffect } from "react";

export const RepeatedReminder = ({ syncReminder }: { syncReminder: () => Promise<void> }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    void syncReminder().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(firstTask, 1000);
      timeoutId = setTimeout(secondTask, 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [syncReminder]);
  return null;
};
