import { memo } from "react";

interface CounterProperties {
  count: number;
}

const CounterView = ({ count }: CounterProperties) => <output>{count}</output>;

export const Counter = memo(CounterView, () => true);
