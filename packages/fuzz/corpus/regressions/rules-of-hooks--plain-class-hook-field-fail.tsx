// rule: rules-of-hooks
// weakness: class-field-scope
// source: synthetic
// verdict: fail
import { useState } from "react";

class CounterModel {
  useCounter = (enabled: boolean) => {
    if (enabled) return useState(0);
    return null;
  };
}

const counterModel = new CounterModel();

export const Counter = ({ enabled }: { enabled: boolean }) => {
  const counter = counterModel.useCounter(enabled);
  return <span>{counter?.[0]}</span>;
};
