import { useState } from "react";
export const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((previous) => --previous)}>{count}</button>;
};
