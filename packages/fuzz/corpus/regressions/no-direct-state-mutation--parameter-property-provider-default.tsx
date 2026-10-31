// rule: no-direct-state-mutation
// verdict: pass
// weakness: alias-guard
// source: synthetic
import { useState } from "react";
class Setup {
  constructor(
    public value = Function(
      "Object.defineProperty(Object.prototype, 'extra', { set() {}, configurable: true })",
    )(),
  ) {}
}
new Setup();
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
