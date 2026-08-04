import { useState as stateHook } from "react";

export const Counter = () => {
  const [count] = stateHook(0);
  return <p>{count}</p>;
};
