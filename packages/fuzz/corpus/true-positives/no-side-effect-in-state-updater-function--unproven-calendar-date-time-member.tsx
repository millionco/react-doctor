// rule: no-side-effect-in-state-updater-function
// weakness: library-provenance
// source: Cursor Bugbot PR #1525
// verdict: fail

import { CalendarDateTime } from "@internationalized/date";
import { useState } from "react";

export const UnprovenCalendarDateTimeMember = () => {
  void CalendarDateTime;
  const [, setValue] = useState({ date: getMutableDate() });
  setValue((previous) => ({
    ...previous,
    date: previous.date.set({ hour: 1 }),
  }));
  return null;
};

export const ReplacedCalendarDateTimeMember = () => {
  const [, setValue] = useState({
    date: new CalendarDateTime(2025, 1, 29, 14, 30),
  });
  setValue({ date: getMutableDate() });
  setValue((previous) => ({
    ...previous,
    date: previous.date.set({ hour: 1 }),
  }));
  return null;
};

export const UnprovenCalendarDateTimeNullishFallback = () => {
  const [, setValue] = useState({ date: getMutableDate() });
  setValue((previous) => ({
    ...previous,
    date: (previous.date ?? new CalendarDateTime(2025, 1, 1, 0, 0)).set({
      hour: 1,
    }),
  }));
  return null;
};

export const UnprovenCalendarDateTimeFalsyFallback = () => {
  const [, setValue] = useState({ date: getMutableDate() });
  setValue((previous) => ({
    ...previous,
    date: (previous.date || new CalendarDateTime(2025, 1, 1, 0, 0)).set({
      hour: 1,
    }),
  }));
  return null;
};
