// rule: effect-needs-cleanup
// weakness: async-lifecycle-provenance
// source: PR #1244 Bugbot review
import { useEffect } from "react";

export const GuardedReminder = ({ syncReminder }: { syncReminder: () => Promise<void> }) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    void syncReminder().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(runReminder, 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId != null) clearTimeout(timeoutId);
      timeoutId = undefined;
    };
  }, [syncReminder]);
  return null;
};
