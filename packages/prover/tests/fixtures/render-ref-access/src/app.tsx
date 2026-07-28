import { useRef } from "react";

export const Counter = () => {
  const renderCount = useRef(0);
  renderCount.current += 1;
  return <p>{renderCount.current}</p>;
};
