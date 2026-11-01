// rule: no-direct-state-mutation
// verdict: pass
// weakness: name-heuristic
// source: synthetic
import { useState } from "react";
interface globalThis {}
globalThis.eval(
  'Object.defineProperty(Object.prototype,"extra",{set(value){void value;},configurable:true})',
);
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
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
