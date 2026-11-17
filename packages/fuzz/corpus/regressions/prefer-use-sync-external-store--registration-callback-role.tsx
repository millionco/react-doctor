// rule: prefer-use-sync-external-store
// verdict: pass
// weakness: callback-role
// source: independently invented registration completion callback
import { useEffect, useState } from "react";

let initialLabel = "ready";
const queuedTasks = new Set();
const registerTask = (task, onRegistered) => {
  queuedTasks.add(task);
  onRegistered(initialLabel);
  return () => queuedTasks.delete(task);
};

export const TaskLabel = () => {
  const [label, setLabel] = useState(initialLabel);
  useEffect(() => registerTask(() => performTask(), setLabel), []);
  return <span>{label}</span>;
};
