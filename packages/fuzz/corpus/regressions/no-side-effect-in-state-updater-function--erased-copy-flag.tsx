// rule: no-side-effect-in-state-updater-function
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useState } from "react";
export const Inventory = ({ items, epoch, ready, onInspect }) => {
  const [record, setRecord] = useState({ epoch: 0, entries: {} });
  const apply = () =>
    setRecord((prior) => {
      let copied = prior.epoch !== epoch;
      let draft = copied ? {} : prior.entries;
      interface copied {}
      for (const item of items) {
        const entry = draft[item.id];
        if (!entry) {
          if (!copied) draft = { ...draft };
          draft[item.id] = { caption: item.caption, expanded: false };
          copied = true;
        } else if (entry.caption !== item.caption) {
          if (!copied) draft = { ...draft };
          draft[item.id] = { ...entry, caption: item.caption, expanded: false };
          copied = true;
        }
      }
      return copied ? { epoch, entries: draft } : prior;
    });
  return <button onClick={apply}>{record.epoch}</button>;
};
