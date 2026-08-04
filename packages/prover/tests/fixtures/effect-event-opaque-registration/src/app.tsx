import { useEffect, useEffectEvent } from "react";

interface Registration {
  handler: () => void;
}

const register = (_registration: Registration) => () => undefined;

export const Reporter = () => {
  const onReport = useEffectEvent(() => undefined);

  useEffect(() => register({ handler: onReport }), []);

  return null;
};
