import { useMemo } from "react";

const readCurrentValue = () => {
  console.log("reading value");
  return 1;
};

export const App = () => {
  const computeValue = () => readCurrentValue();
  const value = useMemo(computeValue, []);
  return <p>{value}</p>;
};
