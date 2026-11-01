// rule: no-direct-state-mutation
// verdict: fail
import { useState } from "react";

interface ChoiceRecord {
  label: string;
  extra?: string;
}

export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one" }]);
  const write = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].extra = "new";
    setRecords(nextRecords);
  };
  return records.map((record, position) => (
    <button key={position} onClick={() => write(position)}>
      {record.label}
    </button>
  ));
};
