// rule: no-side-effect-in-state-updater-function
// weakness: library-provenance
// source: Cursor Bugbot PR #1525
// verdict: fail

import dayjs from "dayjs";
import badMutable from "dayjs/plugin/badMutable";
import utc from "dayjs/plugin/utc";
import { useState } from "react";

dayjs.extend(utc);
dayjs.extend(badMutable);

export const MutableUtcMonth = () => {
  const [, setDate] = useState({ selectedMonth: dayjs.utc() });
  setDate((previous) => ({
    ...previous,
    selectedMonth: previous.selectedMonth.add(1, "month"),
  }));
  return null;
};

export const MutableChainedMonth = () => {
  const [, setDate] = useState(dayjs());
  setDate((previous) => previous.add(1, "month").set("date", 1));
  return null;
};
