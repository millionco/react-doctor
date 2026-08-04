import { useEffectEvent } from "react";

interface ChildProperties {
  onReport: () => void;
}

const Child = (_properties: ChildProperties) => null;

export const Reporter = () => {
  const onReport = useEffectEvent(() => undefined);
  return <Child onReport={onReport} />;
};
