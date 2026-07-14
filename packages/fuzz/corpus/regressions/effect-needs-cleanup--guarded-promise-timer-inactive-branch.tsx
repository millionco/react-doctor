// rule: effect-needs-cleanup
// weakness: async-lifecycle-control-flow
// source: PR #1244 Bugbot review
import { useEffect } from "react";

interface ReminderProps {
  logInactive: () => void;
  syncReminder: () => Promise<void>;
}

export const GuardedReminder = ({ logInactive, syncReminder }: ReminderProps) => {
  useEffect(() => {
    let isActive = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    void syncReminder().then(() => {
      if (!isActive) {
        logInactive();
        return;
      }
      timeoutId = setTimeout(runReminder, 1000);
    });
    return () => {
      isActive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [logInactive, syncReminder]);
  return null;
};
