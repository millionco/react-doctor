// rule: no-prop-callback-in-effect
// weakness: lifecycle-cleanup
// source: adversarial cleanup handback control
// verdict: fail

import { useEffect } from "react";

interface ChildProps {
  source: string;
  onResult: (result: string) => void;
}

export const Child = ({ source, onResult }: ChildProps) => {
  const result = useProperty(source);

  useEffect(() => {
    onResult(result);
    return () => teardown();
  }, [result, onResult]);

  return null;
};
