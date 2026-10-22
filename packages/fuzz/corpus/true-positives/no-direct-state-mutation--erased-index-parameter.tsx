// rule: no-direct-state-mutation
// verdict: fail
// weakness: name-heuristic
// source: synthetic
import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    interface index {}
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return (
    <div>
      {records.map((record, index) => (
        <button key={index} onClick={() => write(index)}>
          {record.label}
        </button>
      ))}
    </div>
  );
};
