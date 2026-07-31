/**
 * Rule: no-side-effect-in-state-updater-function
 * Weakness: library-idiom
 * Source: Bugbot review on PR #1525
 */
import dayjs from "dayjs";
import { useState } from "react";

export const DayjsLazyInitializer = () => {
  const [, setDate] = useState(() => ({ selectedMonth: dayjs() }));
  setDate((previous) => ({
    ...previous,
    selectedMonth: previous.selectedMonth.add(1, "month"),
  }));
};
