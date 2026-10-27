// rule: no-async-event-handler-without-reentry-guard
// weakness: framework-gating
// source: Synthetic classic JSX provider regression
// verdict: pass
import React, { useState } from "react";
import { ActionControl } from "./action-control";

export const Editor = () => {
  const [, setSaved] = useState(false);
  const save = async () => {
    await fetch("/entries", { method: "POST" });
    setSaved(true);
  };
  return <ActionControl onClick={save}>Save</ActionControl>;
};
