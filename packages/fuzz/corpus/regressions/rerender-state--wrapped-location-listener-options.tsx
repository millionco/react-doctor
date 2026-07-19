// rule: rerender-state-only-in-handlers
// weakness: wrapper-transparency
// source: Bugbot review of PR 1311
import { useEffect, useState } from "react";

export const WrappedLocationListenerOptions = () => {
  const [_revision, setRevision] = useState(0);

  useEffect(() => {
    const onPopState = () => setRevision((previous) => previous + 1);
    window.addEventListener("popstate" as const, onPopState, {
      capture: true as const,
    } satisfies AddEventListenerOptions);
    window.removeEventListener("popstate" as const, onPopState, {
      capture: false as const,
    } satisfies EventListenerOptions);
  }, []);

  return <output>{location.pathname}</output>;
};
