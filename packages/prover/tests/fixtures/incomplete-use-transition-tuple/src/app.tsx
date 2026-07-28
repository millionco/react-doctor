import { useState, useTransition } from "react";

export const Panel = () => {
  const [panel, setPanel] = useState("overview");
  const transition = useTransition();

  return (
    <button type="button" onClick={() => transition[1](() => setPanel("activity"))}>
      {panel}
    </button>
  );
};
