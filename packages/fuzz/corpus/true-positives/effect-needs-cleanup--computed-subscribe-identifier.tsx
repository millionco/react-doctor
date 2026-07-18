// rule: effect-needs-cleanup
// weakness: computed-subscription-method
// source: PR #1361 review

import { useEffect } from "react";

interface SubscriptionSource {
  [methodName: string]: (listener: () => void) => void;
}

interface ExampleProps {
  source: SubscriptionSource;
  subscribe: string;
}

export const Example = ({ source, subscribe }: ExampleProps) => {
  useEffect(() => {
    source[subscribe](() => refresh());
  }, [source, subscribe]);

  return null;
};
