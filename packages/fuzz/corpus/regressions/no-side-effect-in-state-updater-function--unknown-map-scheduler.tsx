// rule: no-side-effect-in-state-updater-function
// weakness: library-idiom
// source: PR #1000 final adversarial audit

import { useState } from "react";

interface Queue {
  map: (callback: (row: number) => number) => number[];
}

export const QueuedRows = ({
  onVisit,
  queue,
}: {
  onVisit: (row: number) => void;
  queue: Queue;
}) => {
  const [, setRows] = useState<number[]>([]);
  setRows((_rows) =>
    queue.map((row) => {
      onVisit(row);
      return row;
    }),
  );
  return null;
};
