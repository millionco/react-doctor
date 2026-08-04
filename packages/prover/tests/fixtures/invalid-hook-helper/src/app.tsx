import { useState } from "react";

const readCounter = () => {
  const [count] = useState(0);
  return count;
};

export const Counter = () => <p>{readCounter()}</p>;
