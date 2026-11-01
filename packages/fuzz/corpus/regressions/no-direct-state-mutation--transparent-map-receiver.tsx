// rule: no-direct-state-mutation
// verdict: pass
import { useState } from "react";

interface FlagRecord {
  checked: boolean;
}

export const FlagChoices = () => {
  const [records, setRecords] = useState<FlagRecord[]>([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position] = { ...nextRecords[position], checked: true };
    setRecords(nextRecords);
  };
  return (records as FlagRecord[])!.map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
