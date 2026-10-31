// rule: no-impure-state-updater
// weakness: alias-guard
// source: synthetic installed dependency control, contextual replay in imported-controlled-setter-fuzz.test.ts
// verdict: pass
import { useControlledState } from "@rc-component/util";

const Panel = () => {
  const [value, updateValue] = useControlledState(0);
  updateValue = replacement;
  updateValue((previous) => {
    queueMicrotask(() => notify());
    return previous;
  });
  return null;
};
