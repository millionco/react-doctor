// rule: effect-needs-cleanup
// weakness: name-heuristic
// source: independently authored local setter regression
import { useState } from "react";
export const Billing = () => {
  const [interval, setInterval] = useState("yearly");
  return <button onClick={() => setInterval("monthly")}>{interval}</button>;
};
