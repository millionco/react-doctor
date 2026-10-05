import { useState } from "react";
export const Screen = ({ pending, load }) => {
  const [task, setTask] = useState(null);
  if (pending) throw task;
  return <button onClick={() => setTask(load())}>Load</button>;
};
