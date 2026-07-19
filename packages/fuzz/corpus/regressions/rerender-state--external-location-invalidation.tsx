// rule: rerender-state-only-in-handlers
// weakness: external-snapshot-reconciliation
// source: atomantic/portos React Bench trial write-react-atomantic-portos-169__jEEhcZi
import { useState } from "react";

export const ExternalLocationFilter = () => {
  const [revision, setRevision] = useState(0);
  const isSelected = new URLSearchParams(window.location.search).has("selected");

  const toggle = () => {
    const next = new URLSearchParams(window.location.search);
    next.set("selected", "yes");
    window.history.pushState({}, "", `?${next}`);
    setRevision((previous) => previous + 1);
  };

  return (
    <button type="button" aria-pressed={isSelected} onClick={toggle}>
      Toggle
    </button>
  );
};

export const BatchedExternalLocationFilter = () => {
  const [revision, setRevision] = useState(0);
  const currentPath = window.location.pathname;

  const navigate = () => {
    setRevision((previous) => previous + 1);
    window.history.pushState({}, "", "/next");
  };

  return <button onClick={navigate}>{currentPath}</button>;
};
