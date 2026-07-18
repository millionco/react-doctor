// rule: exhaustive-deps
// weakness: derived-local-equivalence
// source: react-bench Inrupt EzrRGww — valueError is wholly derived from value
import { useEffect, useState } from "react";

export const Image = ({ value, thingError }: { value?: string; thingError?: Error }) => {
  let valueError: Error | undefined;
  if (!value) valueError = new Error("No value found for property.");
  const [, setError] = useState<Error>();
  useEffect(() => {
    setError(thingError ?? valueError);
  }, [thingError, value]);
  return null;
};
