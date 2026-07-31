// rule: no-side-effect-in-state-updater-function
// weakness: library-idiom
// source: PR #1525 parity added[43]
// verdict: pass

import dayjs from "dayjs";
import { useState } from "react";

export const MonthPicker = () => {
  const [, setDate] = useState({ selectedMonth: dayjs() });
  setDate((previous) => ({
    ...previous,
    selectedMonth: previous.selectedMonth.add(1, "month"),
  }));
  return null;
};
