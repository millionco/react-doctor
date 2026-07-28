import { startTransition, useState } from "react";

const loadPanel = async () => Promise.resolve("activity");

export const Panel = () => {
  const [panel, setPanel] = useState("overview");

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(async () => {
          const nextPanel = await loadPanel();
          startTransition(() => setPanel(nextPanel));
        });
      }}
    >
      {panel}
    </button>
  );
};
