// rule: no-effect-event-in-deps, rules-of-hooks, exhaustive-deps
// weakness: library-idiom
// source: fuzz edge-case wave (useEffectEvent origin resolution) — namespace
//         import of a non-React polyfill (`FloatingUI.useEffectEvent`) returns
//         a stable callback; deps listing and prop passing are both valid
import { useEffect } from "react";
import * as FloatingUI from "@floating-ui/react/utils";
import * as utils from "@floating-ui/react/utils";

export const TickPanel = ({ value }: { value: number }) => {
  const onTick = FloatingUI.useEffectEvent(() => value);
  useEffect(() => {
    onTick();
  }, [onTick]);
  return null;
};

export const HandlerPanel = ({ onDone }: { onDone: () => void }) => {
  const handleChange = utils.useEffectEvent(() => onDone());
  return <button onClick={handleChange}>go</button>;
};
