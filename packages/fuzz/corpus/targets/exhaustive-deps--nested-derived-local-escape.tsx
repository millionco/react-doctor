import { useEffect } from "react";

declare const attachRetryError: (error: Error | undefined, retryError: Error) => void;

export const Image = ({
  value,
  retryError,
  setError,
}: {
  value?: string;
  retryError: Error;
  setError: (error: Error | undefined) => void;
}) => {
  let valueError: Error | undefined;
  if (!value) valueError = new Error("No value found for property.");
  (() => attachRetryError(valueError, retryError))();
  useEffect(() => {
    setError(valueError);
  }, [value]);
  return null;
};
