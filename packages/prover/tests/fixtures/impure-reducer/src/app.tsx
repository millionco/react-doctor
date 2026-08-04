import { useReducer } from "react";

const reduceTimestamp = (_timestamp: number) => Date.now();

export const Timestamp = () => {
  const [timestamp] = useReducer(reduceTimestamp, 0);
  return <p>{timestamp}</p>;
};
