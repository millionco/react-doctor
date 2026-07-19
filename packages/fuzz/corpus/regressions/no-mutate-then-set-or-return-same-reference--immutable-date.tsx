// rule: no-mutate-then-set-or-return-same-reference
// weakness: library-idiom
// source: PR #1000 deep precision review

import { useState } from "react";

declare const dayjs: () => { add: (count: number, unit: string) => unknown };

export const Calendar = () => {
  const [, setDate] = useState(dayjs());
  setDate((previous) => {
    previous.add(1, "day");
    return previous;
  });
  return null;
};
