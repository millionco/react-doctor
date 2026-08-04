import { useEffect, useEffectEvent } from "react";

export const Reporter = () => {
  const onReport = useEffectEvent(() => undefined);

  useEffect(() => {
    onReport();
  }, [onReport]);

  return null;
};
