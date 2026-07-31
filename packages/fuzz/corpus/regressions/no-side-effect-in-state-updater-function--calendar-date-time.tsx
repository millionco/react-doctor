// rule: no-side-effect-in-state-updater-function
// weakness: library-idiom
// source: PR #1525 parity added[38] and added[39]
// verdict: pass

import { CalendarDateTime } from "@internationalized/date";
import { useState } from "react";

export const CalendarDateTimeInput = () => {
  const [, setValue] = useState<CalendarDateTime[]>([new CalendarDateTime(2025, 1, 29, 14, 30)]);
  setValue((previous) => {
    const current = previous[0] ?? new CalendarDateTime(2025, 1, 1, 0, 0);
    return [current.set({ hour: 15 })];
  });
  return null;
};
