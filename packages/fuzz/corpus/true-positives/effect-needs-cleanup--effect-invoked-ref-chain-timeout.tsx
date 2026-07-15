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
  const traverseQueueRef = useRef<() => void>(() => undefined);
  const startRef = useRef<() => void>(() => undefined);
  traverseQueueRef.current = () => {
    setTimeout(() => subscription.subscribe(), delay);
  };
  startRef.current = () => traverseQueueRef.current();
  useEffect(() => startRef.current(), [delay, subscription]);
  return null;
};
