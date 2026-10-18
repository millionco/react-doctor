// rule: no-side-effect-in-state-updater-function
// weakness: copy-tracking
// source: synthetic mixed-initializer whole-site regression
// verdict: pass
import { useState } from "react";

interface InventoryEntry {
  caption: string;
}

interface InventoryState {
  epoch: number;
  entries: Record<string, InventoryEntry>;
}

interface InventoryItem {
  id: string;
  caption: string;
}

interface InventoryProps {
  items: InventoryItem[];
  epoch: number;
}

export const CopyUpdates = ({ items, epoch }: InventoryProps) => {
  const [record, setRecord] = useState<InventoryState>({ epoch: 0, entries: {} });
  const apply = () =>
    setRecord((prior) => {
      let copied = prior.epoch !== epoch;
      let draft: Record<string, InventoryEntry> = copied ? {} : prior.entries;
      for (const item of items) {
        const entry = draft[item.id];
        if (!entry) {
          if (!copied) draft = { ...draft };
          draft[item.id] = { caption: item.caption };
          copied = true;
        } else if (entry.caption !== item.caption) {
          if (!copied) draft = { ...draft };
          draft[item.id] = { ...entry, caption: item.caption };
          copied = true;
        }
      }
      return copied ? { epoch, entries: draft } : prior;
    });
  return <button onClick={apply}>{record.epoch}</button>;
};
