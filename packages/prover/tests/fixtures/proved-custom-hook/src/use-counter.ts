import { useState } from "react";

export const useCounter = () => {
  const [count] = useState(0);
  return count;
};
