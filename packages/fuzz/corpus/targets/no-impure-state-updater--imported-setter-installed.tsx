// rule: no-impure-state-updater
// weakness: cross-file
// source: synthetic installed dependency control, contextual replay in imported-controlled-setter-fuzz.test.ts
import { useControlledState } from "@rc-component/util";

const Panel = () => {
  const [value, updateValue] = useControlledState(0);
  updateValue((previous) => {
    queueMicrotask(() => notify());
    return previous;
  });
  return null;
};
