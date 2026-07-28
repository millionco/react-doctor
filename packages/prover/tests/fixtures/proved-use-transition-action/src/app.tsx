import { useCallback, useState, useTransition } from "react";

export const Panel = () => {
  const [panel, setPanel] = useState("overview");
  const [isPending, startPanelTransition] = useTransition();
  const showActivity = useCallback(() => {
    startPanelTransition(() => setPanel("activity"));
  }, [startPanelTransition]);

  return (
    <section aria-busy={isPending}>
      <button type="button" onClick={showActivity}>
        Show activity
      </button>
      <p>{panel}</p>
    </section>
  );
};
