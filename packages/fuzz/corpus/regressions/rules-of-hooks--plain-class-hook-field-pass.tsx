// rule: rules-of-hooks
// weakness: class-field-scope
// source: synthetic
// verdict: pass
import { useState } from "react";

class CounterModel {
  useCounter = () => useState(0);
}

const counterModel = new CounterModel();

export const Counter = () => {
  const { useCounter } = counterModel;
  const [count] = useCounter();
  return <span>{count}</span>;
};
