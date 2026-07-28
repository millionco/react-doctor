import { useEffect } from "react";

interface SubscriptionProperties {
  unsubscribe: () => void;
}

const Subscription = ({ unsubscribe }: SubscriptionProperties) => {
  useEffect(() => () => unsubscribe(), [unsubscribe]);
  return null;
};

export const Application = () => {
  const unsubscribe = () => undefined;
  return <Subscription unsubscribe={unsubscribe} />;
};
