// rule: rerender-state-only-in-handlers
// weakness: nested-call-evaluation-order
// source: Cursor Bugbot review of PR 1311
import { useState } from "react";

const Router = ({ children }: { children: React.ReactNode; onNavigate: () => void }) => children;

export const NestedLocationMutationSetter = () => {
  const [, setRevision] = useState(0);
  const navigate = () => {
    history.pushState({}, "", String(setRevision((previous) => previous + 1)));
  };

  return <Router onNavigate={navigate}>{location.pathname}</Router>;
};
