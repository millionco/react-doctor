// rule: no-side-effect-in-state-updater-function
// weakness: library-idiom
// source: PR #1525 parity added[43]
// verdict: pass

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useState } from "react";

dayjs.extend(utc);

export const MonthPicker = () => {
  const [, setDate] = useState({
    selectedMonth: dayjs(),
    utcMonth: dayjs.utc(),
    unixMonth: dayjs.unix(0),
  });
  setDate((previous) => ({
    ...previous,
    selectedMonth: previous.selectedMonth.add(1, "month"),
    utcMonth: previous.utcMonth.add(1, "month"),
    unixMonth: previous.unixMonth.set("month", 1),
  }));
  return null;
};

export const ScalarMonthPicker = () => {
  const [, setDate] = useState(dayjs());
  setDate((previous) => previous.add(1, "month").set("date", 1));
  return null;
};

export const DirectFactoryMonthPicker = () => {
  const [, setDate] = useState(dayjs());
  setDate(() => dayjs().add(1, "month").set("date", 1));
  return null;
};
