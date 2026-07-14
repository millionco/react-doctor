// rule: effect-needs-cleanup
// weakness: async-lifecycle-cleanup-control-flow
// source: PR #1244 review
import { useEffect } from "react";

interface ReminderProps {
  shouldSkipRelease: boolean;
  syncReminder: () => Promise<void>;
}

export const GuardedReminder = ({ shouldSkipRelease, syncReminder }: ReminderProps) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    void syncReminder().then(() => {
      if (!isActive) return;
      timeoutId = setTimeout(runReminder, 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) {
        if (shouldSkipRelease) return;
        clearTimeout(timeoutId);
      }
    };
  }, [shouldSkipRelease, syncReminder]);
  return null;
};
