// rule: no-async-event-handler-without-reentry-guard
// weakness: control-flow
import { useState } from "react";

export const ExclusiveAction = ({ shouldPost }: { shouldPost: boolean }) => {
  const [, setSaved] = useState(false);
  return (
    <button
      onClick={async () => {
        if (shouldPost) await api.post();
        else setSaved(true);
      }}
    />
  );
};
