// rule: prefer-use-effect-event
// weakness: control-flow
// source: react-bench write-react-lobehub-lobe-ui-508__F6Q7Cj7
import { useEffect } from "react";

interface TypewriterEffectProps {
  delay: number;
  onComplete: (value: string) => void;
}

export const TypewriterEffect = ({ delay, onComplete }: TypewriterEffectProps) => {
  useEffect(() => {
    const finish = () => onComplete("done");
    if (delay === 0) finish();
    const timeoutId = setTimeout(finish, delay);
    return () => clearTimeout(timeoutId);
  }, [delay, onComplete]);

  return null;
};
