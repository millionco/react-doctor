/**
 * Rule: no-side-effect-in-state-updater-function
 * Weakness: copy-tracking
 * Source: Bugbot review on PR #1525
 */
import dayjs from "dayjs";
import { useState } from "react";

export const DayjsReceiverAlias = () => {
  const [, setDate] = useState({ selectedMonth: dayjs() });
  setDate((previous) => {
    const selectedMonth = previous.selectedMonth;
    return {
      ...previous,
      selectedMonth: selectedMonth.add(1, "month"),
    };
  });
};
