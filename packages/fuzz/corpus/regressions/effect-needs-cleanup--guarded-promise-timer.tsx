// rule: effect-needs-cleanup
// weakness: control-flow
// source: https://github.com/millionco/react-doctor/issues/1241
import { useEffect, useState } from "react";

const PERMISSION_RECHECK_DELAY_MS = 5_000;

interface ReminderProps {
  syncReminder: () => Promise<"permission-pending" | "complete">;
}

export const Reminder = ({ syncReminder }: ReminderProps) => {
  const [, setPermissionCheckTick] = useState(0);

  useEffect(() => {
    let isActive = true;
    let permissionRecheckTimeout: ReturnType<typeof setTimeout> | undefined;

    void syncReminder().then((result) => {
      if (!isActive || result !== "permission-pending") return;
      permissionRecheckTimeout = setTimeout(() => {
        if (isActive) setPermissionCheckTick((currentTick) => currentTick + 1);
      }, PERMISSION_RECHECK_DELAY_MS);
    });

    return () => {
      isActive = false;
      if (permissionRecheckTimeout) clearTimeout(permissionRecheckTimeout);
    };
  }, [syncReminder]);

  return null;
};
