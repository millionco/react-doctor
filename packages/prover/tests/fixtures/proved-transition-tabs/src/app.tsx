import { startTransition, useState } from "react";

interface Tab {
  id: string;
  label: string;
}

const initialTabs: ReadonlyArray<Tab> = [
  { id: "files", label: "Files" },
  { id: "settings", label: "Settings" },
];

export const Tabs = () => {
  const [tabs, setTabs] = useState(initialTabs);

  const removeTab = (tabId: string) => {
    startTransition(() => {
      setTabs((previousTabs) => previousTabs.filter((tab) => tab.id !== tabId));
    });
  };

  return (
    <section>
      <button type="button" onClick={() => removeTab("settings")}>
        Close settings
      </button>
      <p>{tabs.length} tabs</p>
    </section>
  );
};
