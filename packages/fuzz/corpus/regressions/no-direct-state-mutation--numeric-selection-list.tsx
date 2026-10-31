// rule: no-direct-state-mutation
// verdict: pass
import { useState } from "react";
interface ChoiceRecord {
  label: string;
  active: boolean;
}
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position] = { ...nextRecords[position], active: true };
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return (
    <section title={labels.join(",")}>
      {records.map((record, position) => (
        <button key={position} onClick={() => add(position)}>
          {record.label}
        </button>
      ))}
      {chosen.map((position) => (
        <button key={position} onClick={() => remove(position)}>
          Remove
        </button>
      ))}
    </section>
  );
};
