import { useEffectEvent } from "react";

export const Reporter = () => {
  const onReport = useEffectEvent(() => undefined);
  onReport();
  return null;
};
