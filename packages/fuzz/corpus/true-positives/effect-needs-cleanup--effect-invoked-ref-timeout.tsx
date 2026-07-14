// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: Victory 75549cf8c67e3ea220f862eb7f530c36d540d41c
import { useEffect, useRef } from "react";

interface AnimatedValueProps {
  delay: number;
  subscription: {
    subscribe: () => void;
  };
}

export const AnimatedValue = ({ delay, subscription }: AnimatedValueProps) => {
  const callbackRef = useRef<() => void>(() => undefined);
  callbackRef.current = () => {
    setTimeout(() => subscription.subscribe(), delay);
  };
  useEffect(() => callbackRef.current(), [delay, subscription]);
  return null;
};
