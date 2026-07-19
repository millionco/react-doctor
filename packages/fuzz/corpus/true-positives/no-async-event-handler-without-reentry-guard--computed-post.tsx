// rule: no-async-event-handler-without-reentry-guard
// weakness: property-shape
import { useState } from "react";

export const SaveButton = () => {
  const [, setSaved] = useState(false);
  return (
    <button
      onClick={async () => {
        await api["post"]();
        setSaved(true);
      }}
    />
  );
};
