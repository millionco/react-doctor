// rule: no-side-effect-in-state-updater-function
// verdict: fail
// weakness: receiver-provenance
// source: React Bench 0.9.6 exhaustive audit

import { useState } from "react";

export const HistoryMutation = ({ href }) => {
  const [, setParams] = useState(new URLSearchParams());
  setParams((previous) => {
    const next = new URLSearchParams(previous);
    window.history.pushState(null, "", href);
    return next;
  });
  return null;
};

export const BodyDestructuredCallback = (props) => {
  const { activeIds, onSelectedRowsChange } = props;
  const [, setSelectedRowIds] = useState([]);
  setSelectedRowIds((previous) => {
    const next = previous.filter((id) => activeIds.includes(id));
    if (next.length !== previous.length) onSelectedRowsChange(next);
    return next;
  });
  return null;
};
