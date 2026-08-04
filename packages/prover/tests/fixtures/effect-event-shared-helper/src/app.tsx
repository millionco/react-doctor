import { useEffect, useEffectEvent } from "react";

export const App = () => {
  const onTick = useEffectEvent(() => {});
  const invokeTick = () => onTick();

  useEffect(() => {
    invokeTick();
  }, [invokeTick]);

  return (
    <button type="button" onClick={invokeTick}>
      Tick
    </button>
  );
};
